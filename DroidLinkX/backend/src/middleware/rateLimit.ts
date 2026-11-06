import type { NextFunction, Request, Response } from 'express';
import { cache } from '../store/cache.js';
import { AppError } from '../utils/errors.js';

type LimitOptions = {
  /** Bucket name, e.g. "auth:login". */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Identify the caller; defaults to IP + user id when present. */
  key?: (req: Request) => string;
};

export function rateLimit(options: LimitOptions) {
  const { name, limit, windowSeconds } = options;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identity = options.key?.(req) ?? `${req.ip ?? 'unknown'}|${req.user?.sub ?? 'anon'}`;
      // Tests exercise the limiter explicitly (RATE_LIMIT_STRICT=true); otherwise keep functional
      // test flows from tripping shared loopback-IP buckets.
      const relaxed = process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_STRICT !== 'true';
      const effectiveLimit = relaxed ? limit * 100 : limit;
      const key = `ratelimit:${name}:${identity}`;
      const { count, ttl } = await cache().incr(key, windowSeconds);
      res.setHeader('X-RateLimit-Limit', String(effectiveLimit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, effectiveLimit - count)));
      res.setHeader('X-RateLimit-Reset', String(ttl));
      if (count > effectiveLimit) {
        res.setHeader('Retry-After', String(ttl));
        throw new AppError('RATE_LIMITED', 'Too many requests. Slow down and try again later.', { retryAfter: ttl });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
