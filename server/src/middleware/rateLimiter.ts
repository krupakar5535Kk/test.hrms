import type { Request, Response, NextFunction } from 'express';
import { ApiErrorCode } from '@hrms/shared';
import { env } from '../config/env.js';
import { hmacSha256Hex } from '../services/hrmsDomain.js';
import { AppError } from './errorHandler.js';

interface RateBucket {
  count: number;
  resetAtMs: number;
}

const buckets = new Map<string, RateBucket>();

export function _resetRateLimitsForTesting(): void {
  buckets.clear();
}

export interface RateLimitOptions {
  keyPrefix: string;
  maxAttempts: number;
  windowMs: number;
  identifierExtractor?: (req: Request) => string;
}

export function createRateLimiter(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rawIdentifier = options.identifierExtractor ? options.identifierExtractor(req) : '';
    const keyHash = hmacSha256Hex(
      env.RATE_LIMIT_HMAC_KEY,
      `${options.keyPrefix}:${rawIp}:${rawIdentifier}`
    );

    const now = Date.now();
    const existing = buckets.get(keyHash);
    if (!existing || existing.resetAtMs <= now) {
      buckets.set(keyHash, { count: 1, resetAtMs: now + options.windowMs });
      res.setHeader('X-RateLimit-Limit', String(options.maxAttempts));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.maxAttempts - 1)));
      next();
      return;
    }

    if (existing.count >= options.maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(
        new AppError(
          429,
          ApiErrorCode.RATE_LIMITED,
          `Too many attempts. Please try again in ${retryAfterSeconds} seconds.`,
          [{ message: `Retry after ${retryAfterSeconds}s`, code: 'RATE_LIMITED' }]
        )
      );
      return;
    }

    existing.count += 1;
    res.setHeader('X-RateLimit-Limit', String(options.maxAttempts));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.maxAttempts - existing.count)));
    next();
  };
}
