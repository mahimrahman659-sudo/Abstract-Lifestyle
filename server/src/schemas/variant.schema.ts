import { z } from 'zod';

export const createVariantSchema = z.object({
  sku: z.string().trim().min(1).max(64).toUpperCase(),
  size: z.string().trim().max(20).nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
  price: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).default(5),
  images: z.array(z.string().trim().max(300)).default([]),
});

export const updateVariantSchema = createVariantSchema.partial();

export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
