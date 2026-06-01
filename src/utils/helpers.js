/**
 * src/utils/helpers.js
 * General-purpose utility functions shared across the codebase.
 */
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

/**
 * Generate a short, URL-safe tracking ID prefixed with 'ORD-'.
 * Format: ORD-<8 hex chars>-<timestamp base36>
 * Guaranteed uniqueness at human-traffic scale; back off to DB UNIQUE constraint for safety.
 */
export function generateTrackingId() {
  const randomPart    = crypto.randomBytes(4).toString('hex').toUpperCase();
  const timestampPart = Date.now().toString(36).toUpperCase();
  return `ORD-${randomPart}-${timestampPart}`;
}

/**
 * Generate a standard UUID v4.
 */
export function generateUUID() {
  return uuidv4();
}

/**
 * Format a numeric amount to 2 decimal places as a string.
 * PayHere requires exactly "100.00" format.
 */
export function formatAmount(amount) {
  return Number(amount).toFixed(2);
}

/**
 * Compute MD5 hash of a string, returning uppercase hex.
 */
export function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

/**
 * Constant-time string comparison to prevent timing attacks on secrets.
 */
export function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still run the compare to prevent length-based timing leak
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Sleep for N milliseconds — used in worker back-off loops.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a safe pagination object from query params.
 */
export function parsePagination(query) {
  const page  = Math.max(1, parseInt(query.page, 10)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
