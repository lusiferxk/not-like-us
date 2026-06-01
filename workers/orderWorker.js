/**
 * workers/orderWorker.js
 * SQS Long-Polling Daemon — order-processing-queue consumer.
 *
 * Responsibilities:
 *   1. Poll the order-processing-queue for incoming guest orders
 *   2. Insert the order header into the `orders` table
 *   3. Insert line items into `order_items` (in a transaction)
 *   4. Pre-compute PayHere IPG payment parameters
 *   5. Delete the SQS message on success (at-least-once delivery guarantee)
 *
 * Run: node workers/orderWorker.js
 *      npm run worker:orders
 */
import 'dotenv/config';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

import { sqsClient, QUEUE_URLS }  from '../src/config/sqs.js';
import { getClient }              from '../src/config/db.js';
import { buildPayHereParams }     from '../src/services/payhere.js';
import logger                     from '../src/utils/logger.js';
import { sleep }                  from '../src/utils/helpers.js';

const QUEUE_URL          = QUEUE_URLS.ORDER_PROCESSING;
const WAIT_TIME_SECONDS  = Number(process.env.SQS_WAIT_TIME_SECONDS)  || 20;
const MAX_MESSAGES       = Number(process.env.SQS_MAX_MESSAGES)        || 10;
const VISIBILITY_TIMEOUT = Number(process.env.SQS_VISIBILITY_TIMEOUT)  || 60;

let isRunning = true;

// ─── Core message processor ───────────────────────────────────────────────────
async function processOrderMessage(message) {
  const body    = JSON.parse(message.Body);
  const payload = body.payload;

  logger.info({ msg: 'Processing order message', trackingId: payload.trackingId });

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Insert order header
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders
         (tracking_id, customer_name, customer_email, customer_phone,
          shipping_address, city, country, total_amount, currency,
          status, payment_status, sqs_message_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending','Awaiting',$10,$11)
       RETURNING *`,
      [
        payload.trackingId,
        payload.customerName,
        payload.customerEmail,
        payload.customerPhone || null,
        payload.shippingAddress,
        payload.city          || null,
        payload.country       || 'LK',
        payload.totalAmount,
        payload.currency      || 'LKR',
        message.MessageId,
        payload.notes         || null,
      ],
    );

    const order = orderRows[0];

    // 2. Insert order line items
    for (const item of payload.items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.productId, item.productName, item.unitPrice, item.quantity],
      );
    }

    await client.query('COMMIT');

    // 3. Pre-compute PayHere parameters (no DB write — just returned for logging/cache)
    const payHereParams = buildPayHereParams(order);

    logger.info({
      msg:           'Order successfully persisted',
      orderId:       order.id,
      trackingId:    order.tracking_id,
      totalAmount:   order.total_amount,
      itemCount:     payload.items.length,
      payHereHash:   payHereParams.hash,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // Re-throw so the message is NOT deleted and goes back to queue
  } finally {
    client.release();
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function pollQueue() {
  logger.info({ msg: '📦 Order Worker started', queue: 'order-processing-queue' });

  while (isRunning) {
    try {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl:            QUEUE_URL,
          MaxNumberOfMessages: MAX_MESSAGES,
          WaitTimeSeconds:     WAIT_TIME_SECONDS,
          VisibilityTimeout:   VISIBILITY_TIMEOUT,
          AttributeNames:      ['All'],
        }),
      );

      const messages = response.Messages || [];

      if (!messages.length) {
        logger.debug({ msg: 'No messages in order queue. Long-polling...' });
        continue;
      }

      logger.info({ msg: `Received ${messages.length} order message(s)` });

      // Process messages concurrently within the batch
      await Promise.allSettled(
        messages.map(async (msg) => {
          try {
            await processOrderMessage(msg);

            // Delete from queue on success
            await sqsClient.send(
              new DeleteMessageCommand({
                QueueUrl:      QUEUE_URL,
                ReceiptHandle: msg.ReceiptHandle,
              }),
            );

            logger.debug({ msg: 'Order message deleted from queue', messageId: msg.MessageId });
          } catch (err) {
            logger.error({
              msg:       'Order message processing failed — will retry after visibility timeout',
              messageId: msg.MessageId,
              error:     err.message,
              stack:     err.stack,
            });
            // Message returns to queue automatically after VisibilityTimeout expires
          }
        }),
      );
    } catch (err) {
      logger.error({ msg: 'SQS receive error in order worker', error: err.message });
      await sleep(5_000); // Back-off before retrying
    }
  }

  logger.info({ msg: 'Order Worker shut down' });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => { isRunning = false; });
process.on('SIGINT',  () => { isRunning = false; });

// ─── Entrypoint ───────────────────────────────────────────────────────────────
pollQueue().catch((err) => {
  logger.error({ msg: 'Fatal error in Order Worker', error: err.message });
  process.exit(1);
});
