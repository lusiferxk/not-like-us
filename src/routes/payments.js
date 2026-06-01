/**
 * src/routes/payments.js
 * POST /api/v1/payments/notify — PayHere IPG asynchronous webhook receiver.
 *
 * Flow:
 *   1. Zod validates the webhook body schema
 *   2. MD5 signature is recalculated and verified
 *   3. On valid signature → payload pushed to payment-success-queue
 *   4. Returns 200 OK immediately (PayHere requires this within 3s)
 *   5. On invalid signature → returns 400 (PayHere will retry)
 */
import { Router }                     from 'express';
import { validate }                   from '../middleware/validate.js';
import { paymentNotifySchema }        from '../validators/paymentSchema.js';
import { verifyPayHereSignature }     from '../services/payhere.js';
import { publishPaymentToQueue }      from '../services/sqsPublisher.js';
import logger                         from '../utils/logger.js';

const router = Router();

/**
 * POST /api/v1/payments/notify
 */
router.post('/notify', validate(paymentNotifySchema), async (req, res, next) => {
  try {
    const payload = req.body;

    // Verify PayHere MD5 signature
    const isValid = verifyPayHereSignature(payload);

    if (!isValid) {
      logger.warn({
        msg:      'PayHere webhook signature verification FAILED',
        orderId:  payload.order_id,
        received: payload.md5sig,
      });

      return res.status(400).json({
        success: false,
        error:   'Signature verification failed.',
      });
    }

    // Only process successful payment status codes
    // PayHere status: 2 = success, 0 = pending, -1 = cancelled, -2 = failed, -3 = chargebacked
    const statusCode = parseInt(payload.status_code, 10);

    logger.info({
      msg:        'PayHere webhook received',
      orderId:    payload.order_id,
      paymentId:  payload.payment_id,
      statusCode,
      amount:     payload.payhere_amount,
      currency:   payload.payhere_currency,
    });

    // Enqueue for processing regardless of status — worker handles status routing
    await publishPaymentToQueue({
      ...payload,
      status_code: statusCode,
    });

    // PayHere requires a plain 200 OK response
    return res.status(200).send('OK');
  } catch (err) {
    next(err);
  }
});

export default router;
