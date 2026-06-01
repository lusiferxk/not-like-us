/**
 * src/middleware/auth.js
 * Admin route guard — Bearer token authentication.
 * Uses constant-time comparison to prevent timing-based secret extraction.
 */
import { secureCompare } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Middleware: requireAdmin
 * Extracts the Bearer token from the Authorization header and validates it
 * against ADMIN_SECRET. Rejects with 401 on missing token or 403 on mismatch.
 */
export function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || '';

  if (!authHeader.startsWith('Bearer ')) {
    logger.warn({ msg: 'Admin auth rejected — missing Bearer header', ip: req.ip, path: req.path });
    return res.status(401).json({
      success: false,
      error:   'Authorization header with Bearer token required.',
    });
  }

  const token  = authHeader.slice(7).trim();
  const secret = process.env.ADMIN_SECRET || '';

  if (!secureCompare(token, secret)) {
    logger.warn({ msg: 'Admin auth rejected — invalid token', ip: req.ip, path: req.path });
    return res.status(403).json({
      success: false,
      error:   'Invalid or expired admin token.',
    });
  }

  logger.debug({ msg: 'Admin access granted', path: req.path });
  next();
}
