import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    CLIENT_ORIGIN: z.string().url().default('http://localhost:3000'),
    SHIPPING_FEE: z.coerce.number().int().nonnegative().default(0),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters'),
    /**
     * Express "trust proxy" setting, e.g. `1` behind one reverse proxy.
     * Empty (default) = disabled. Numbers are applied as numbers; other
     * values pass through as Express trust-proxy strings (e.g. "loopback").
     * Required in production (see superRefine below).
     */
    TRUST_PROXY: z.string().trim().default(''),
    /** Global per-IP API rate limit (requests per minute). */
    API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
    /** Per-user checkout limit (requests per minute). */
    ORDER_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
    /** Per-user upload limit (requests per minute). */
    UPLOAD_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(20),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') {
      return;
    }
    if (value.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be at least 32 characters in production',
      });
    }
    if (!value.TRUST_PROXY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          'TRUST_PROXY must be set in production (e.g. "1" behind a single reverse proxy) so rate limiting and secure cookies see the real client IP',
      });
    }
    const weakAdminPassword =
      value.ADMIN_PASSWORD.length < 12 ||
      /change[-_]?me/i.test(value.ADMIN_PASSWORD) ||
      /password/i.test(value.ADMIN_PASSWORD) ||
      value.ADMIN_PASSWORD.toLowerCase() === value.ADMIN_EMAIL.toLowerCase();
    if (weakAdminPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_PASSWORD'],
        message:
          'ADMIN_PASSWORD is too weak for production: use 12+ characters and avoid "change-me"/"password" or the admin email',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

