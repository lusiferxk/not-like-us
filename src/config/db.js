/**
 * src/config/db.js
 * PostgreSQL connection pool — singleton pattern.
 * All DB access in this application goes through this pool.
 */
import pg from 'pg';
import 'dotenv/config';
import logger from '../utils/logger.js';

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // Pool sizing — tune for your instance class
  max:                  Number(process.env.DB_POOL_MAX)                  || 20,
  idleTimeoutMillis:    Number(process.env.DB_POOL_IDLE_TIMEOUT_MS)    || 30_000,
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS) || 5_000,

  // Keep-alive to survive idle proxy timeouts (e.g. RDS Proxy, PgBouncer)
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  
  // AWS RDS requires SSL connections
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Surface connection errors immediately rather than silently failing
pool.on('error', (err) => {
  logger.error({ msg: 'Idle PostgreSQL client error', error: err.message });
});

pool.on('connect', () => {
  logger.debug({ msg: 'New PostgreSQL client connected to pool' });
});

/**
 * Execute a parameterized query using a pool-checked-out client.
 * @param {string} text  — SQL with $1/$2 placeholders
 * @param {any[]}  params — Query parameters
 */
export const query = (text, params) => pool.query(text, params);

/**
 * Acquire a dedicated client for multi-statement transactions.
 * Remember to call client.release() in a finally block.
 */
export const getClient = () => pool.connect();

export default pool;
