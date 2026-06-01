/**
 * workers/emailWorker.js
 * SQS Long-Polling Daemon — email-notification-queue consumer.
 *
 * Dispatches transactional order receipt emails via the Resend API.
 * The SQS queue remains in place — Resend is only the final delivery layer.
 *
 * Run: node workers/emailWorker.js
 *      npm run worker:emails
 */
import 'dotenv/config';
import { Resend } from 'resend';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

import { sqsClient, QUEUE_URLS } from '../src/config/sqs.js';
import logger                    from '../src/utils/logger.js';
import { sleep }                 from '../src/utils/helpers.js';

const QUEUE_URL          = QUEUE_URLS.EMAIL_NOTIFICATION;
const WAIT_TIME_SECONDS  = Number(process.env.SQS_WAIT_TIME_SECONDS)  || 20;
const MAX_MESSAGES       = Number(process.env.SQS_MAX_MESSAGES)        || 10;
const VISIBILITY_TIMEOUT = Number(process.env.SQS_VISIBILITY_TIMEOUT)  || 60;

// Resend client — initialised once, reused across all messages
const resend = new Resend(process.env.RESEND_API_KEY);

let isRunning = true;

// ─── HTML receipt template ─────────────────────────────────────────────────────
function buildOrderReceiptHTML(job) {
  const { customerName, trackingId, totalAmount, currency, items } = job;

  const itemsHTML = (items || [])
    .map(
      (item) =>
        `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB">${item.product_name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${item.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:right">${currency} ${Number(item.unit_price).toFixed(2)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:600">${currency} ${(item.unit_price * item.quantity).toFixed(2)}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Order Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1A56DB 0%,#1E429F 100%);padding:36px 40px">
              <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;letter-spacing:-0.5px">
                Order Confirmed
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px">
                Thank you for your purchase, ${customerName}!
              </p>
            </td>
          </tr>

          <!-- Tracking ID banner -->
          <tr>
            <td style="background:#EFF6FF;padding:16px 40px;border-bottom:1px solid #DBEAFE">
              <p style="margin:0;font-size:13px;color:#1E40AF;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">
                Tracking ID
              </p>
              <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#1E3A8A;font-family:monospace;letter-spacing:1px">
                ${trackingId}
              </p>
            </td>
          </tr>

          <!-- Order items -->
          <tr>
            <td style="padding:32px 40px">
              <h2 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px">
                Order Summary
              </h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                <thead>
                  <tr style="background:#F9FAFB">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #E5E7EB">Item</th>
                    <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #E5E7EB">Qty</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #E5E7EB">Unit</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #E5E7EB">Total</th>
                  </tr>
                </thead>
                <tbody>${itemsHTML}</tbody>
              </table>

              <!-- Grand total -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">
                <tr>
                  <td align="right" style="padding:16px 12px 0">
                    <span style="font-size:18px;font-weight:700;color:#1A56DB">
                      Total: ${currency} ${Number(totalAmount).toFixed(2)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;text-align:center">
              <p style="margin:0;font-size:12px;color:#9CA3AF">
                Keep your Tracking ID safe to follow your order status.
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#D1D5DB">
                &copy; ${new Date().getFullYear()} Your Store. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Dispatch via Resend ───────────────────────────────────────────────────────
async function sendViaResend(job) {
  const html = buildOrderReceiptHTML(job);

  const { data, error } = await resend.emails.send({
    from:    process.env.RESEND_FROM_ADDRESS,
    to:      [job.to],
    subject: `Order Confirmed — ${job.trackingId}`,
    html,
    // Plain-text fallback for email clients that block HTML
    text: `Hi ${job.customerName},\n\nYour order has been confirmed.\n\nTracking ID: ${job.trackingId}\nTotal: ${job.currency} ${Number(job.totalAmount).toFixed(2)}\n\nThank you for shopping with us.`,
    // Optional: tag emails for Resend dashboard filtering
    tags: [
      { name: 'category',   value: 'order-receipt' },
      { name: 'tracking_id', value: job.trackingId },
    ],
  });

  if (error) {
    // Resend returns errors as objects rather than throwing — normalise to a throw
    throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
  }

  return data; // { id: 're_...' } — Resend's message ID
}

// ─── Message processor ────────────────────────────────────────────────────────
async function processEmailMessage(message) {
  const body = JSON.parse(message.Body);
  const job  = body.payload;

  logger.info({ msg: 'Dispatching order receipt via Resend', to: job.to, trackingId: job.trackingId });

  const result = await sendViaResend(job);

  logger.info({
    msg:        'Email sent via Resend',
    to:          job.to,
    trackingId:  job.trackingId,
    resendId:    result?.id,
  });
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function pollQueue() {
  logger.info({ msg: 'Email Worker started', queue: 'email-notification-queue', transport: 'Resend' });

  while (isRunning) {
    try {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl:            QUEUE_URL,
          MaxNumberOfMessages: MAX_MESSAGES,
          WaitTimeSeconds:     WAIT_TIME_SECONDS,
          VisibilityTimeout:   VISIBILITY_TIMEOUT,
        }),
      );

      const messages = response.Messages || [];

      if (!messages.length) {
        logger.debug({ msg: 'No messages in email queue. Long-polling...' });
        continue;
      }

      logger.info({ msg: `Received ${messages.length} email job(s)` });

      // Fire all jobs in the batch concurrently — Resend handles rate limits on their end
      await Promise.allSettled(
        messages.map(async (msg) => {
          try {
            await processEmailMessage(msg);

            await sqsClient.send(
              new DeleteMessageCommand({
                QueueUrl:      QUEUE_URL,
                ReceiptHandle: msg.ReceiptHandle,
              }),
            );
          } catch (err) {
            logger.error({
              msg:       'Email dispatch failed — message will retry after visibility timeout',
              messageId: msg.MessageId,
              error:     err.message,
            });
            // Do NOT delete — message returns to queue for retry
          }
        }),
      );
    } catch (err) {
      logger.error({ msg: 'SQS receive error in email worker', error: err.message });
      await sleep(5_000);
    }
  }

  logger.info({ msg: 'Email Worker shut down cleanly' });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => { isRunning = false; });
process.on('SIGINT',  () => { isRunning = false; });

// ─── Entrypoint ───────────────────────────────────────────────────────────────
pollQueue().catch((err) => {
  logger.error({ msg: 'Fatal error in Email Worker', error: err.message });
  process.exit(1);
});
