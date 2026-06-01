/**
 * src/router.js
 * Unified route registry — mounts all sub-routers onto their paths.
 * Import this into server.js as the single routing entry point.
 */
import { Router }          from 'express';
import ordersRouter        from './routes/orders.js';
import paymentsRouter      from './routes/payments.js';
import adminProductsRouter from './routes/admin/products.js';
import adminOrdersRouter   from './routes/admin/orders.js';

const router = Router();

// ─── Public Routes ─────────────────────────────────────────────────────────
router.use('/orders',           ordersRouter);
router.use('/payments',         paymentsRouter);

// ─── Admin Routes ──────────────────────────────────────────────────────────
router.use('/admin/products',   adminProductsRouter);
router.use('/admin/orders',     adminOrdersRouter);

// ─── Health Check ──────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'not-like-us-backend',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
  });
});

export default router;
