import { z } from 'zod';
import { objectIdSchema } from './common.schema.js';

export const adminIdParamsSchema = z.object({ id: objectIdSchema });

export const adminOrderStatusUpdateSchema = z.object({
  status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
});

export const adminVariantQuerySchema = z.object({
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const adminProductQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const adminOrderQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const adminCustomerQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type AdminOrderStatusUpdateInput = z.infer<typeof adminOrderStatusUpdateSchema>;
export type AdminVariantQuery = z.infer<typeof adminVariantQuerySchema>;
export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;
export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;
export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;
