import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  try {
    redisClient = new Redis(
      parseInt(process.env.REDIS_PORT || '6379', 10),
      process.env.REDIS_HOST || 'localhost',
      { maxRetriesPerRequest: 1, lazyConnect: false }
    );
    redisClient.on('error', () => {
      redisClient = null;
    });
    return redisClient;
  } catch {
    return null;
  }
}

const RATE_LIMIT_LUA = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`;

interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
}

/**
 * Per-tenant API rate limiter backed by Redis.
 * Falls closed (blocks) if Redis is unavailable.
 */
export function rateLimiter(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || 'unknown';
    const tenantId = req.user?.tenantId || 'anon';

    const redis = getRedis();
    if (!redis) {
      logger.warn('[RateLimiter] Redis unavailable, failing closed.');
      return res.status(503).json({ error: 'Service temporarily unavailable. Rate limiter cannot verify request.' });
    }

    const key = `api_ratelimit:${clientIp}:${tenantId}:${req.method}:${req.baseUrl || req.path}`;
    try {
      const count = await redis.eval(RATE_LIMIT_LUA, 1, key, opts.windowSeconds) as number;

      res.setHeader('X-RateLimit-Limit', String(opts.maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.maxRequests - count)));

      if (count > opts.maxRequests) {
        logger.warn(`[RateLimiter] ${clientIp}/${tenantId} exceeded ${opts.maxRequests} reqs/${opts.windowSeconds}s on ${req.method} ${req.path}`);
        return res.status(429).json({
          error: `Rate limit exceeded. Max ${opts.maxRequests} requests per ${opts.windowSeconds} seconds.`,
          retryAfterSeconds: opts.windowSeconds,
        });
      }

      next();
    } catch (err: any) {
      logger.warn('[RateLimiter] Redis error during rate check, failing closed.', { error: err.message });
      return res.status(503).json({ error: 'Service temporarily unavailable.' });
    }
  };
}
