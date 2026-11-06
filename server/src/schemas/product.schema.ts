import { z } from 'zod';
import { objectIdSchema } from './common.schema.js';

const productImageSchema = z.union([
  z.string().trim().min(1).max(300),
  z.object({
    url: z.string().trim().min(1).max(300),
    publicId: z.string().trim().max(200).nullable().optional(),
  }),
]);

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  category: objectIdSchema,
  basePrice: z.number().int().min(0),
  images: z.array(productImageSchema).max(10).default([]),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
});

// Defaults are stripped before .partial() so PATCHes never re-inject them.
export const updateProductSchema = createProductSchema
  .extend({
    images: z.array(productImageSchema).max(10).optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
  })
  .partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

const csvToArray = (value: string | undefined): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
};

// Public catalog query. Every value is a string/number — object-shaped query
// params (e.g. ?category[$ne]=x) can never reach a Mongo filter.
export const productListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sizes: z.string().optional().transform(csvToArray),
  colors: z.string().optional().transform(csvToArray),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'relevance']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productSlugSchema = z.string().trim().min(1).max(200);

