import { z } from 'zod';

/**
 * Assets uploaded but never attached to a saved product (image removed before
 * saving, or an abandoned new-product form) are destroyed through this payload.
 */
export const destroyAssetsSchema = z.object({
  publicIds: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
});

export type DestroyAssetsInput = z.infer<typeof destroyAssetsSchema>;
