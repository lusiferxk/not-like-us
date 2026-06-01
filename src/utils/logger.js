/**
 * src/utils/logger.js
 * Structured JSON logger using Winston.
 * Outputs colored logs in development, JSON in production.
 */
import { createLogger, format, transports } from 'winston';
import 'dotenv/config';

const { combine, timestamp, errors, json, colorize, printf } = format;

const isProduction = process.env.NODE_ENV === 'production';

const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
  return `[${timestamp}] ${level}: ${message} ${metaStr}`;
});

const logger = createLogger({
  level: isProduction ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    isProduction ? json() : combine(colorize(), devFormat),
  ),
  transports: [
    new transports.Console(),
    // Persistent file logs in production
    ...(isProduction
      ? [
          new transports.File({ filename: 'logs/error.log',   level: 'error' }),
          new transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
  exitOnError: false,
});

export default logger;
