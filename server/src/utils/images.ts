/** A stored product/variant image. `publicId` is null for legacy local-disk values. */
export interface ImageAsset {
  url: string;
  publicId: string | null;
}

/**
 * Products store images as objects `{ url, publicId }`, but legacy documents
 * hold plain strings (`/uploads/...`). This normalizes either shape.
 */
export const toImageAsset = (value: unknown): ImageAsset | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? { url: trimmed, publicId: null } : null;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as { url?: unknown; publicId?: unknown };
    if (typeof record.url === 'string' && record.url.trim().length > 0) {
      return {
        url: record.url.trim(),
        publicId: typeof record.publicId === 'string' && record.publicId.trim().length > 0
          ? record.publicId.trim()
          : null,
      };
    }
  }
  return null;
};

/** Normalizes an unknown images array into assets (legacy strings included). */
export const normalizeImages = (images: unknown): ImageAsset[] => {
  if (!Array.isArray(images)) {
    return [];
  }
  return images
    .map((value) => toImageAsset(value))
    .filter((asset): asset is ImageAsset => asset !== null);
};

/** Plain URL list for public/storefront DTOs. */
export const imageUrls = (images: unknown): string[] =>
  normalizeImages(images).map((asset) => asset.url);

/** First image URL, or null. */
export const firstImageUrl = (images: unknown): string | null => imageUrls(images)[0] ?? null;
