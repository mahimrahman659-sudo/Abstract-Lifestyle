import { z } from 'zod';
import { BD_MOBILE_ERROR, normalizeBdMobile } from '../utils/phone.js';

// Normalize first (trim + lowercase), then validate the email format.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Bangladeshi mobile number: spaces/dashes are stripped, +880/880 prefixes are
 * accepted and the value is normalized to 01XXXXXXXXX before it is saved.
 */
export const phoneSchema = z
  .string()
  .trim()
  .max(20, BD_MOBILE_ERROR)
  .transform((value) => normalizeBdMobile(value) ?? value)
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, BD_MOBILE_ERROR));

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  name: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

/** Google Identity Services ID-token credential (a JWT — bounded length). */
export const googleAuthSchema = z.object({
  credential: z.string().trim().min(10).max(4096),
});

export const addressSchema = z.object({
  label: z.string().trim().max(30).optional(),
  fullName: z.string().trim().min(1).max(100),
  phone: phoneSchema,
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
  isDefault: z.boolean().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type AddressInput = z.infer<typeof addressSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Defaults are stripped before .partial() so PATCHes never re-inject them.
export const addressUpdateSchema = addressSchema
  .extend({ isDefault: z.boolean().optional() })
  .partial();

export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;

