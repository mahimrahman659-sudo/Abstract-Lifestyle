import { z } from 'zod';
import { LOW_STOCK_THRESHOLD_DEFAULT } from '../utils/stock.js';

export const createVariantSchema = z.object({
  sku: z.string().trim().min(1).max(64).toUpperCase(),
  size: z.string().trim().max(20).nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
  price: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).default(LOW_STOCK_THRESHOLD_DEFAULT),
  images: z.array(z.string().trim().max(300)).default([]),
});

// Defaults are stripped before .partial() so PATCHes never re-inject them.
export const updateVariantSchema = createVariantSchema
  .extend({
    lowStockThreshold: z.number().int().min(0).optional(),
    images: z.array(z.string().trim().max(300)).optional(),
  })
  .partial();

export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
