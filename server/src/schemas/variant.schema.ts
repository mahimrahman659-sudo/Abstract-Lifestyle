import { z } from 'zod';
import { COMPARE_AT_RULE_MESSAGE } from '../utils/pricing.js';
import { normalizeColor, normalizeSize } from '../utils/sizes.js';
import { LOW_STOCK_THRESHOLD_DEFAULT } from '../utils/stock.js';

/**
 * Size/color accept `""` and turn it into `null`, so a blank value can never be
 * stored (and therefore never renders as a blank size button).
 */
const sizeField = z
  .union([z.string().trim().max(20), z.null()])
  .transform((value) => normalizeSize(value));

const colorField = z
  .union([z.string().trim().max(40), z.null()])
  .transform((value) => normalizeColor(value));

const imageListField = z.array(z.string().trim().min(1).max(300)).max(10);

export const createVariantSchema = z.object({
  sku: z.string().trim().min(1).max(64).toUpperCase(),
  size: sizeField.optional(),
  color: colorField.optional(),
  price: z.number().int().min(0).nullable().optional(),
  /** Only used when the variant has its own price; must exceed that price. */
  compareAtPrice: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).default(LOW_STOCK_THRESHOLD_DEFAULT),
  images: imageListField.default([]),
});

// Defaults are stripped before .partial() so PATCHes never re-inject them.
export const updateVariantSchema = createVariantSchema
  .extend({
    lowStockThreshold: z.number().int().min(0).optional(),
    images: imageListField.optional(),
    /**
     * Stock the client loaded. Stock edits use it as a compare-and-set guard so
     * an admin save cannot silently overwrite an order's stock decrement.
     */
    expectedStock: z.number().int().min(0).optional(),
  })
  .partial();

/**
 * Creates one variant per size in a single request (the common clothing case),
 * with a generated `PREFIX-SIZE` SKU per row.
 */
export const bulkCreateVariantsSchema = z
  .object({
    skuPrefix: z.string().trim().min(1).max(40),
    color: colorField.optional(),
    price: z.number().int().min(0).nullable().optional(),
    compareAtPrice: z.number().int().min(0).nullable().optional(),
    lowStockThreshold: z.number().int().min(0).default(LOW_STOCK_THRESHOLD_DEFAULT),
    items: z
      .array(
        z.object({
          size: z.string().trim().min(1).max(20),
          stock: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(20),
    images: imageListField.default([]),
  })
  .superRefine((value, ctx) => {
    if (
      value.price !== null &&
      value.price !== undefined &&
      value.compareAtPrice !== null &&
      value.compareAtPrice !== undefined &&
      value.compareAtPrice <= value.price
    ) {
      ctx.addIssue({ code: 'custom', path: ['compareAtPrice'], message: COMPARE_AT_RULE_MESSAGE });
    }

    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      const key = normalizeSize(item.size)?.toLowerCase();
      if (!key) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'size'], message: 'Enter a size' });
        return;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'size'],
          message: 'Each size can only be added once',
        });
      }
      seen.add(key);
    });
  });

export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type BulkCreateVariantsInput = z.infer<typeof bulkCreateVariantsSchema>;
