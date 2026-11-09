import {
  SiteImageModel,
  SITE_IMAGE_KEYS,
  type SiteImageKey,
} from '../models/site-image.model.js';
import type { UpdateSiteImageInput } from '../schemas/site-image.schema.js';
import { toImageAsset, type ImageAsset } from '../utils/images.js';
import { destroyImageAsset } from './upload.service.js';

export interface SiteImageDto {
  key: SiteImageKey;
  image: ImageAsset | null;
}

const toDto = (doc: { image: unknown } | null, key: SiteImageKey): SiteImageDto => ({
  key,
  image: doc ? toImageAsset(doc.image) : null,
});

/** All slots in canonical order; empty or missing slots return `image: null`. */
export const listSiteImages = async (): Promise<SiteImageDto[]> => {
  const docs = await SiteImageModel.find({ key: { $in: SITE_IMAGE_KEYS } }).exec();
  return SITE_IMAGE_KEYS.map((key) => toDto(docs.find((doc) => doc.key === key) ?? null, key));
};

/**
 * Sets (or clears) one slot. Replacing a slot destroys the previous Cloudinary
 * asset (best-effort) so nothing is orphaned.
 */
export const updateSiteImage = async (
  key: SiteImageKey,
  image: UpdateSiteImageInput['image'],
): Promise<SiteImageDto> => {
  const existing = await SiteImageModel.findOne({ key }).exec();
  const previous = existing ? toImageAsset(existing.image) : null;

  const doc = await SiteImageModel.findOneAndUpdate(
    { key },
    { $set: { image } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();

  if (previous?.publicId && previous.publicId !== image?.publicId) {
    await destroyImageAsset(previous.publicId);
  }

  return toDto(doc, key);
};