/**
 * src/routes/orders.js
 * POST /api/v1/orders — Guest checkout fast-path.
 *
 * Flow:
 *   1. Zod validates the request body (< 5ms)
 *   2. A unique Order tracking ID is stamped
 *   3. Payload is pushed to SQS order-processing-queue
 *   4. 202 Accepted is immediately returned — no DB touch on this path
 *
 * Target response time: < 50ms
 */
import { Router } from 'express';
import { validate }              from '../middleware/validate.js';
import { orderSchema }           from '../validators/orderSchema.js';
import { publishOrderToQueue }   from '../services/sqsPublisher.js';
import { generateTrackingId, formatAmount } from '../utils/helpers.js';
import logger                    from '../utils/logger.js';

const router = Router();

/**
 * POST /api/v1/orders
 */
router.post('/', validate(orderSchema), async (req, res, next) => {
  try {
    const orderData = req.body;

    // Compute total from cart items (server-side authoritative calculation)
    const totalAmount = orderData.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );

    const trackingId = generateTrackingId();

    const sqsPayload = {
      trackingId,
      ...orderData,
      totalAmount: formatAmount(totalAmount),
      receivedAt:  new Date().toISOString(),
    };

    const sqsResponse = await publishOrderToQueue(sqsPayload);

    logger.info({
      msg:         'Order queued successfully',
      trackingId,
      sqsMessageId: sqsResponse.MessageId,
      itemCount:   orderData.items.length,
      totalAmount,
    });

    return res.status(202).json({
      success:    true,
      message:    'Order received. Your tracking ID is ready.',
      trackingId,
      totalAmount: formatAmount(totalAmount),
      currency:   orderData.currency || 'LKR',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
