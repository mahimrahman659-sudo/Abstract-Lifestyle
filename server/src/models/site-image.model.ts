import { Schema, model } from 'mongoose';

/** Storefront image slots the admin can manage (extensible — add keys here). */
export const SITE_IMAGE_KEYS = ['hero', 'promo-1', 'promo-2'] as const;

export type SiteImageKey = (typeof SITE_IMAGE_KEYS)[number];

export interface SiteImage {
  key: SiteImageKey;
  /** Cloudinary asset (`{ url, publicId }`), or null when the slot is empty. */
  image: { url: string; publicId: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

const siteImageSchema = new Schema<SiteImage>(
  {
    key: { type: String, required: true, unique: true },
    // Same loose shape as product images (legacy strings tolerated on read);
    // input is strictly validated with Zod in schemas/site-image.schema.ts.
    image: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const SiteImageModel = model<SiteImage>('SiteImage', siteImageSchema);