import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

const customFormat = printf(({ level, message, timestamp, ...meta }) => {
  return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
});

/**
 * Enterprise-grade structured logger representing all platform telemetry.
 * In production, this outputs pure JSON lines. In development, it outputs colorized plaintext.
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' 
    ? combine(timestamp(), json()) 
    : combine(colorize(), timestamp(), customFormat),
  transports: [
    new winston.transports.Console()
  ]
});
