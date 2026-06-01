/**
 * workers/paymentWorker.js
 * SQS Long-Polling Daemon — payment-success-queue consumer.
 *
 * CRITICAL PATH — Atomic inventory & payment update:
 *   1. Poll payment-success-queue
 *   2. Locate the order by tracking_id (= PayHere order_id)
 *   3. BEGIN a PostgreSQL transaction with SERIALIZABLE isolation
 *   4. Lock the order row with SELECT ... FOR UPDATE (prevents double-processing)
 *   5. Update order payment_status → 'Paid', status → 'Paid'
 *   6. Atomically decrement product stock for each line item:
 *        UPDATE products SET stock = stock - qty WHERE id = ? AND stock >= qty
 *      If stock = 0 → rollback + log alert (sold out race condition)
 *   7. Enqueue an email job to email-notification-queue
 *   8. COMMIT
 *   9. Delete SQS message
 *
 * Run: node workers/paymentWorker.js
 *      npm run worker:payments
 */
import 'dotenv/config';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

import { sqsClient, QUEUE_URLS }  from '../src/config/sqs.js';
import { getClient }              from '../src/config/db.js';
import { publishEmailJob }        from '../src/services/sqsPublisher.js';
import logger                     from '../src/utils/logger.js';
import { sleep }                  from '../src/utils/helpers.js';

const QUEUE_URL          = QUEUE_URLS.PAYMENT_SUCCESS;
const WAIT_TIME_SECONDS  = Number(process.env.SQS_WAIT_TIME_SECONDS)  || 20;
const MAX_MESSAGES       = Number(process.env.SQS_MAX_MESSAGES)        || 10;
const VISIBILITY_TIMEOUT = Number(process.env.SQS_VISIBILITY_TIMEOUT)  || 60;

let isRunning = true;

// ─── Atomic payment + inventory processor ────────────────────────────────────
async function processPaymentMessage(message) {
  const body    = JSON.parse(message.Body);
  const payload = body.payload;

  const {
    order_id: trackingId,
    payment_id,
    payhere_amount,
    payhere_currency,
    status_code,
  } = payload;

  // Only process PayHere success status (2 = success)
  if (status_code !== 2) {
    logger.warn({
      msg:         'Non-success PayHere status — skipping inventory update',
      trackingId,
      statusCode:  status_code,
    });
    return; // Still delete message below — no need to retry
  }

  logger.info({ msg: 'Processing payment success', trackingId, paymentId: payment_id });

  const client = await getClient();

  try {
    // Use SERIALIZABLE isolation for maximum safety under concurrent payment events
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // 1. Fetch & lock the order row — prevents concurrent payment events racing
    const { rows: orderRows } = await client.query(
      `SELECT o.id, o.tracking_id, o.payment_status, o.customer_name,
              o.customer_email, o.total_amount, o.currency
       FROM orders o
       WHERE o.tracking_id = $1
       FOR UPDATE`,
      [trackingId],
    );

    if (!orderRows.length) {
      throw new Error(`Order not found for tracking_id: ${trackingId}`);
    }

    const order = orderRows[0];

    // Idempotency guard — do not double-process already-paid orders
    if (order.payment_status === 'Paid') {
      logger.warn({
        msg:        'Order already marked Paid — idempotency guard triggered',
        orderId:    order.id,
        trackingId,
      });
      await client.query('COMMIT');
      return;
    }

    // 2. Update order status atomically
    await client.query(
      `UPDATE orders
       SET payment_status = 'Paid',
           status         = 'Paid',
           payhere_order_id   = $2,
           payhere_payment_id = $3
       WHERE id = $1`,
      [order.id, trackingId, payment_id],
    );

    // 3. Fetch order line items
    const { rows: items } = await client.query(
      `SELECT oi.product_id, oi.quantity, oi.product_name, oi.unit_price
       FROM order_items oi
       WHERE oi.order_id = $1`,
      [order.id],
    );

    // 4. Atomically decrement stock for each item
    //    Uses conditional update: only subtracts if sufficient stock exists.
    //    If any product is out of stock, the transaction rolls back.
    for (const item of items) {
      const { rowCount } = await client.query(
        `UPDATE products
         SET stock = stock - $1
         WHERE id = $2 AND stock >= $1`,
        [item.quantity, item.product_id],
      );

      if (rowCount === 0) {
        throw Object.assign(
          new Error(`Insufficient stock for product ${item.product_id} (${item.product_name})`),
          { code: 'INSUFFICIENT_STOCK', productId: item.product_id },
        );
      }
    }

    // 5. Commit the atomic block
    await client.query('COMMIT');

    logger.info({
      msg:        '✅ Payment processed & inventory decremented atomically',
      orderId:    order.id,
      trackingId,
      itemCount:  items.length,
    });

    // 6. Enqueue email notification (outside transaction — eventual consistency is fine for email)
    await publishEmailJob({
      to:          order.customer_email,
      customerName: order.customer_name,
      trackingId:  order.tracking_id,
      totalAmount: order.total_amount,
      currency:    order.currency,
      items,
    });
  } catch (err) {
    await client.query('ROLLBACK');

    if (err.code === 'INSUFFICIENT_STOCK') {
      logger.error({
        msg:       '🚨 STOCK CONFLICT — inventory insufficient after payment',
        trackingId,
        error:     err.message,
        productId: err.productId,
      });
      // Mark order as requiring manual review instead of re-queuing indefinitely
      try {
        await client.query(
          `UPDATE orders SET status = 'Cancelled', notes = $2 WHERE tracking_id = $1`,
          [trackingId, `Stock conflict: ${err.message}`],
        );
      } catch (updateErr) {
        logger.error({ msg: 'Failed to mark order as Cancelled after stock conflict', error: updateErr.message });
      }
      return; // Do not re-throw — delete the message to prevent infinite retry
    }

    throw err; // Re-throw other errors — message stays in queue for retry
  } finally {
    client.release();
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function pollQueue() {
  logger.info({ msg: '💳 Payment Worker started', queue: 'payment-success-queue' });

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
        logger.debug({ msg: 'No messages in payment queue. Long-polling...' });
        continue;
      }

      // Process SEQUENTIALLY to avoid concurrent transactions on the same order
      // (SQS may deliver the same order's payment more than once under retries)
      for (const msg of messages) {
        try {
          await processPaymentMessage(msg);

          await sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl:      QUEUE_URL,
              ReceiptHandle: msg.ReceiptHandle,
            }),
          );
        } catch (err) {
          logger.error({
            msg:       'Payment message processing failed — will retry',
            messageId: msg.MessageId,
            error:     err.message,
          });
        }
      }
    } catch (err) {
      logger.error({ msg: 'SQS receive error in payment worker', error: err.message });
      await sleep(5_000);
    }
  }

  logger.info({ msg: 'Payment Worker shut down' });
}

process.on('SIGTERM', () => { isRunning = false; });
process.on('SIGINT',  () => { isRunning = false; });

pollQueue().catch((err) => {
  logger.error({ msg: 'Fatal error in Payment Worker', error: err.message });
  process.exit(1);
});
