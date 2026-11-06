import { rateLimit } from 'express-rate-limit';

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
