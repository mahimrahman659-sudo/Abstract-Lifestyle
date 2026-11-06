import { rateLimit } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env.js';

/** Rate limiter for credential endpoints (login/register): 10 attempts per 15 minutes per IP. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
    });
  },
});

/**
 * Keys authenticated requests by user id (limiters using this must run after
 * requireAuth) and falls back to the client IP for anonymous requests.
 */
const userOrIpKey = (req: Request): string =>
  req.user ? `user:${req.user._id.toString()}` : `ip:${req.ip ?? 'unknown'}`;

const perMinuteLimiter = (
  limit: number,
  message: string,
  keyGenerator?: (req: Request) => string,
) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator
      ? { keyGenerator, validate: { keyGeneratorIpFallback: false } }
      : {}),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
  });

/** Generous global baseline for the whole API, per IP. */
export const apiRateLimiter = perMinuteLimiter(
  env.API_RATE_LIMIT_PER_MIN,
  'Too many requests. Please try again later.',
);

/** Checkout limiter — per authenticated user. */
export const orderCreateRateLimiter = perMinuteLimiter(
  env.ORDER_RATE_LIMIT_PER_MIN,
  'Too many checkout attempts. Please wait a minute and try again.',
  userOrIpKey,
);

/** Admin image upload limiter — per authenticated user. */
export const uploadRateLimiter = perMinuteLimiter(
  env.UPLOAD_RATE_LIMIT_PER_MIN,
  'Too many uploads. Please wait a minute and try again.',
  userOrIpKey,
);

