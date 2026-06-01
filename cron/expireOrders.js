/**
 * cron/expireOrders.js
 * EventBridge Scheduler Target — Pending Order Expiration Cron.
 *
 * This script is the execution target invoked by AWS EventBridge Scheduler
 * every 2 hours. It can be deployed as:
 *   a) An AWS Lambda function (recommended — zero server cost)
 *   b) A locally-executed Node.js script (for testing / non-Lambda targets)
 *
 * Cron Schedule (EventBridge rate expression): rate(2 hours)
 * Alternatively: cron(0 * /2 * * ? *)   ← note: space in "* /2" prevents premature comment close
 *
 * Workflow:
 *   1. Scans for orders with status = 'Pending' AND created_at < NOW() - INTERVAL '2 hours'
 *   2. Marks them as 'Expired'
 *   3. Restores the product inventory that was tentatively consumed
 *   4. Logs a summary of the operation
 *
 * Run manually: node cron/expireOrders.js
 *               npm run cron:expire-orders
 */
import 'dotenv/config';
import { getClient } from '../src/config/db.js';
import logger from '../src/utils/logger.js';

const EXPIRY_THRESHOLD_HOURS = 2;

async function expirePendingOrders() {
  logger.info({ msg: 'EventBridge cron triggered: expirePendingOrders', threshold: `${EXPIRY_THRESHOLD_HOURS}h` });

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Find all expired pending orders — lock them
    const { rows: expiredOrders } = await client.query(
      `SELECT o.id, o.tracking_id, o.created_at
       FROM orders o
       WHERE o.status = 'Pending'
         AND o.created_at < NOW() - (INTERVAL '1 hour' * $1)
       FOR UPDATE SKIP LOCKED`,
      [EXPIRY_THRESHOLD_HOURS],
    );

    if (!expiredOrders.length) {
      logger.info({ msg: 'No pending orders to expire.' });
      await client.query('COMMIT');
      return { expired: 0, inventoryRestored: 0 };
    }

    logger.info({ msg: `Found ${expiredOrders.length} pending order(s) to expire` });

    const orderIds = expiredOrders.map((o) => o.id);

    // 2. Restore inventory for each expired order's line items
    //    We restore stock ONLY for orders that were Pending (never paid → no real stock reduction)
    //    Note: The payment worker only decrements stock on 'Paid' status, so Pending orders
    //    have NOT yet had stock decremented. This restoration is a safety guard for
    //    any tentative reservation pattern you may add later.
    //
    //    If you implement a stock-reservation system at order creation time, uncomment:
    //
    // for (const orderId of orderIds) {
    //   await client.query(
    //     `UPDATE products p
    //      SET stock = p.stock + oi.quantity
    //      FROM order_items oi
    //      WHERE oi.order_id = $1 AND p.id = oi.product_id`,
    //     [orderId],
    //   );
    // }

    // 3. Bulk-update all expired orders to 'Expired' status
    //    Uses = ANY($1::uuid[]) — single bound array parameter, no dynamic SQL building.
    const { rowCount } = await client.query(
      `UPDATE orders
       SET status = 'Expired',
           payment_status = CASE WHEN payment_status = 'Awaiting' THEN 'Failed' ELSE payment_status END
       WHERE id = ANY($1::uuid[])`,
      [orderIds],
    );

    await client.query('COMMIT');

    const summary = {
      msg: 'Order expiration cron completed',
      ordersExpired: rowCount,
      trackingIds: expiredOrders.map((o) => o.tracking_id),
      executedAt: new Date().toISOString(),
    };

    logger.info(summary);
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ msg: 'Error during order expiration cron', error: err.message, stack: err.stack });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * AWS Lambda handler entry point.
 * EventBridge Scheduler invokes this when the function is deployed as Lambda.
 *
 * @param {object} event   — EventBridge event payload (unused for this cron)
 * @param {object} context — Lambda execution context
 */
export const handler = async (event, context) => {
  logger.info({ msg: 'Lambda invoked by EventBridge', event, requestId: context?.awsRequestId });

  try {
    const result = await expirePendingOrders();
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── Direct script execution (local / CLI testing) ────────────────────────────
// When run as: node cron/expireOrders.js
if (process.argv[1].endsWith('expireOrders.js')) {
  expirePendingOrders()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ msg: 'Fatal cron error', error: err.message });
      process.exit(1);
    });
}
