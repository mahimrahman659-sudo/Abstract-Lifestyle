import { z } from 'zod';
import { objectIdSchema } from './common.schema.js';

/** Maximum quantity per line item per request. */
export const MAX_LINE_QUANTITY = 20;

export const cartItemParamsSchema = z.object({
  variantId: objectIdSchema,
});

export const addToCartSchema = z.object({
  variantId: objectIdSchema,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

// Envelope only: entries are validated one by one so invalid entries can be
// skipped without failing the whole merge request.
export const mergeCartSchema = z.object({
  items: z.array(z.unknown()).min(1).max(100),
});

export const mergeCartItemSchema = z.object({
  variantId: objectIdSchema,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type MergeCartItemInput = z.infer<typeof mergeCartItemSchema>;
