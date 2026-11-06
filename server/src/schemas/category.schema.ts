import { z } from 'zod';
import { objectIdSchema } from './common.schema.js';

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
  parent: objectIdSchema.nullable().optional(),
  image: z.string().trim().max(300).optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
