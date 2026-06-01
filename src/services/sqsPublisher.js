/**
 * src/services/sqsPublisher.js
 * Typed SQS message publisher wrappers.
 * Each function targets a specific queue and encapsulates the SendMessage call.
 */
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { sqsClient, QUEUE_URLS } from '../config/sqs.js';
import logger from '../utils/logger.js';

/**
 * Core send helper — wraps SendMessageCommand with logging and error propagation.
 *
 * @param {string} queueUrl      — Target SQS queue URL
 * @param {object} messageBody   — Payload object (will be JSON-serialized)
 * @param {object} [options]     — Optional SQS params (DelaySeconds, MessageGroupId, etc.)
 */
async function sendToQueue(queueUrl, messageBody, options = {}) {
  const command = new SendMessageCommand({
    QueueUrl:    queueUrl,
    MessageBody: JSON.stringify(messageBody),
    ...options,
  });

  const response = await sqsClient.send(command);

  logger.info({
    msg:       'SQS message published',
    queue:     queueUrl.split('/').pop(),   // log only queue name, not full URL
    messageId: response.MessageId,
  });

  return response;
}

/**
 * Push a new guest order to the order-processing-queue.
 * @param {object} orderPayload — Validated order body + generated tracking_id
 */
export async function publishOrderToQueue(orderPayload) {
  return sendToQueue(QUEUE_URLS.ORDER_PROCESSING, {
    event:   'ORDER_RECEIVED',
    payload: orderPayload,
    ts:      new Date().toISOString(),
  });
}

/**
 * Push a verified PayHere webhook payload to the payment-success-queue.
 * @param {object} paymentPayload — Validated PayHere notification body
 */
export async function publishPaymentToQueue(paymentPayload) {
  return sendToQueue(QUEUE_URLS.PAYMENT_SUCCESS, {
    event:   'PAYMENT_NOTIFIED',
    payload: paymentPayload,
    ts:      new Date().toISOString(),
  });
}

/**
 * Push an email dispatch job to the email-notification-queue.
 * @param {object} emailJob — { to, subject, orderDetails, trackingId }
 */
export async function publishEmailJob(emailJob) {
  return sendToQueue(QUEUE_URLS.EMAIL_NOTIFICATION, {
    event:   'EMAIL_DISPATCH',
    payload: emailJob,
    ts:      new Date().toISOString(),
  });
}
