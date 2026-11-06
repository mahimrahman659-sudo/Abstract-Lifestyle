import { z } from 'zod';

// Normalize first (trim + lowercase), then validate the email format.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  name: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const addressSchema = z.object({
  label: z.string().trim().max(30).optional(),
  fullName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6).max(20),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(1).max(100),
  isDefault: z.boolean().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AddressInput = z.infer<typeof addressSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const addressUpdateSchema = addressSchema
  .extend({ isDefault: z.boolean().optional() })
  .partial();

export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;

