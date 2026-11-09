import { z } from 'zod';
import { SITE_IMAGE_KEYS } from '../models/site-image.model.js';

export const siteImageKeySchema = z.enum(SITE_IMAGE_KEYS);

const imageAssetSchema = z.object({
  url: z.string().url(),
  publicId: z.string().min(1).nullable(),
});

/** Body for PUT /admin/site-images/:key — `null` clears the slot. */
export const updateSiteImageSchema = z.object({
  image: imageAssetSchema.nullable(),
});

export type UpdateSiteImageInput = z.infer<typeof updateSiteImageSchema>;