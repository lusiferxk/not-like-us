/**
 * src/server.js
 * Express application bootstrap & entry point.
 *
 * Responsibilities:
 *  - Load environment variables
 *  - Configure Express with security, rate-limiting, and logging middleware
 *  - Mount the unified router at /api/v1
 *  - Attach 404 and global error handlers
 *  - Start the HTTP server with graceful shutdown on SIGTERM/SIGINT
 */
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import router from './router.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import pool from './config/db.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

// ─── Security Headers ────────────────────────────────────────────────────────
app.use(helmet());

// ─── Request Logging ─────────────────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http({ msg: msg.trim() }) },
  }),
);

// ─── Body Parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

// Stricter limiter for the order endpoint specifically
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 30,
  message: { success: false, error: 'Order submission rate limit exceeded. Slow down.' },
});

app.use('/api', globalLimiter);
app.use(`/api/${API_VERSION}/orders`, orderLimiter);

// Trust the first proxy hop (required for correct IP in rate-limit headers on AWS ALB/ECS)
app.set('trust proxy', 1);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use(`/api/${API_VERSION}`, router);

// ─── 404 & Error Boundaries ──────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Server Bootstrap ─────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info({
    msg: 'Server running...',
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    apiBase: `/api/${API_VERSION}`,
  });
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  logger.info({ msg: `${signal} received — shutting down gracefully` });

  server.close(async () => {
    logger.info({ msg: 'HTTP server closed' });

    try {
      await pool.end();
      logger.info({ msg: 'PostgreSQL pool closed' });
    } catch (err) {
      logger.error({ msg: 'Error closing DB pool', error: err.message });
    }

    process.exit(0);
  });

  // Force exit if graceful shutdown takes > 10s
  setTimeout(() => {
    logger.error({ msg: 'Forced shutdown after timeout' });
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ msg: 'Unhandled Promise Rejection', reason: String(reason) });
});

export default app;
