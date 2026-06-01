/**
 * src/middleware/errorHandler.js
 * Global Express error boundary.
 * Catches all errors thrown or passed via next(err) and returns a
 * structured JSON response. Never leaks stack traces in production.
 */
import logger from '../utils/logger.js';

/**
 * 404 Not Found — mount AFTER all routers.
 */
export function notFound(req, res) {
  res.status(404).json({
    success: false,
    error:   `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Global error handler — mount as the very last middleware.
 * Signature must be (err, req, res, next) — 4 args — for Express to treat it as error middleware.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status  = err.status || err.statusCode || 500;
  const isServer = status >= 500;

  logger[isServer ? 'error' : 'warn']({
    msg:    err.message,
    status,
    method: req.method,
    path:   req.originalUrl,
    stack:  isServer ? err.stack : undefined,
  });

  res.status(status).json({
    success: false,
    error:   isServer && process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred. Please try again later.'
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}
