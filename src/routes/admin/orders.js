/**
 * src/routes/admin/orders.js
 * Admin order management routes.
 *
 * Routes:
 *   GET  /api/v1/admin/orders         — paginated order list with filters
 *   GET  /api/v1/admin/orders/:id     — single order with line items
 *   GET  /api/v1/admin/orders/export  — streaming Excel/CSV download
 *   PUT  /api/v1/admin/orders/:id/status — manually override order status
 */
import { Router }                                      from 'express';
import { query }                                       from '../../config/db.js';
import { requireAdmin }                                from '../../middleware/auth.js';
import { parsePagination }                             from '../../utils/helpers.js';
import { streamOrdersExcel, streamOrdersCSV }          from '../../services/excelExporter.js';
import logger                                          from '../../utils/logger.js';

const router = Router();

router.use(requireAdmin);

// ─── GET /api/v1/admin/orders ─────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, payment_status, email, from, to } = req.query;

    const conditions = [];
    const params     = [];
    let   idx        = 1;

    if (status) {
      conditions.push(`o.status = $${idx++}`);
      params.push(status);
    }
    if (payment_status) {
      conditions.push(`o.payment_status = $${idx++}`);
      params.push(payment_status);
    }
    if (email) {
      conditions.push(`o.customer_email ILIKE $${idx++}`);
      params.push(`%${email}%`);
    }
    if (from) {
      conditions.push(`o.created_at >= $${idx++}`);
      params.push(new Date(from));
    }
    if (to) {
      conditions.push(`o.created_at <= $${idx++}`);
      params.push(new Date(to));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ rows: orders }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT o.id, o.tracking_id, o.customer_name, o.customer_email,
                o.customer_phone, o.shipping_address, o.city, o.country,
                o.total_amount, o.currency, o.status, o.payment_status,
                o.payhere_order_id, o.payhere_payment_id, o.created_at, o.updated_at
         FROM orders o
         ${whereClause}
         ORDER BY o.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      query(`SELECT COUNT(*) FROM orders o ${whereClause}`, params),
    ]);

    return res.json({
      success: true,
      data:    orders,
      pagination: {
        page,
        limit,
        total:      parseInt(countRows[0].count, 10),
        totalPages: Math.ceil(parseInt(countRows[0].count, 10) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/admin/orders/export ─────────────────────────────────────────
// IMPORTANT: this route must be declared BEFORE /:id to avoid routing ambiguity
router.get('/export', async (req, res, next) => {
  try {
    const { status, payment_status, from, to } = req.query;
    const format = (req.query.format || 'xlsx').toLowerCase();

    const conditions = [];
    const params     = [];
    let   idx        = 1;

    if (status)         { conditions.push(`o.status = $${idx++}`);           params.push(status); }
    if (payment_status) { conditions.push(`o.payment_status = $${idx++}`);   params.push(payment_status); }
    if (from)           { conditions.push(`o.created_at >= $${idx++}`);      params.push(new Date(from)); }
    if (to)             { conditions.push(`o.created_at <= $${idx++}`);      params.push(new Date(to)); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Cap export at 50,000 rows for server safety
    const { rows: orders } = await query(
      `SELECT o.tracking_id, o.customer_name, o.customer_email, o.customer_phone,
              o.shipping_address, o.city, o.country, o.total_amount, o.currency,
              o.status, o.payment_status, o.payhere_order_id, o.created_at
       FROM orders o
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT 50000`,
      params,
    );

    logger.info({ msg: 'Admin orders export triggered', rowCount: orders.length, format });

    if (format === 'csv') {
      return streamOrdersCSV(res, orders);
    }
    return await streamOrdersExcel(res, orders);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/admin/orders/:id ────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [{ rows: orderRows }, { rows: itemRows }] = await Promise.all([
      query('SELECT * FROM orders WHERE id = $1', [req.params.id]),
      query(
        `SELECT oi.*, p.slug AS product_slug, p.image_url
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1
         ORDER BY oi.id`,
        [req.params.id],
      ),
    ]);

    if (!orderRows.length) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    return res.json({
      success: true,
      data:    { ...orderRows[0], items: itemRows },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/v1/admin/orders/:id/status ─────────────────────────────────────
router.put('/:id/status', async (req, res, next) => {
  try {
    const VALID_STATUSES = ['Pending', 'Paid', 'Shipped', 'Delivered', 'Cancelled', 'Expired'];
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error:   `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const { rows } = await query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, tracking_id, status',
      [status, req.params.id],
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    logger.info({ msg: 'Admin manually updated order status', orderId: req.params.id, status });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
