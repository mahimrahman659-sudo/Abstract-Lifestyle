import type { UploadApiResponse } from 'cloudinary';
import { cloudinary, CLOUDINARY_FOLDER, isCloudinaryConfigured } from '../config/cloudinary.js';
import { AppError } from '../middleware/error-handler.js';
import type { ImageAsset } from '../utils/images.js';

type SupportedImageType = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'bmp' | 'tiff';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** ISO-BMFF `ftyp` major brands that mean HEIC/HEIF. */
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

/** ISO-BMFF `ftyp` major brands that mean AVIF. */
const AVIF_BRANDS = ['avif', 'avis'];

/**
 * Detects the real image type from file content (magic bytes), never from names
 * or browser MIME hints — so renamed files (e.g. an iPhone HEIC saved as .jpg)
 * are still recognized.
 */
export const detectImageType = (buffer: Buffer): SupportedImageType | null => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  // ISO-BMFF container: bytes 4–8 are 'ftyp', bytes 8–12 the major brand.
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (AVIF_BRANDS.includes(brand)) {
      return 'avif';
    }
    if (HEIF_BRANDS.includes(brand)) {
      return 'heic';
    }
    return null;
  }
  if (buffer.length >= 14 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'bmp';
  }
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return 'tiff';
  }
  return null;
};

/**
 * Upload format per detected type. Camera/web formats (HEIC, AVIF, BMP, TIFF)
 * are converted to jpeg on upload so the storefront always serves web-safe
 * images; jpeg/png/webp keep their original format.
 */
const FORMAT_BY_TYPE: Record<SupportedImageType, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  heic: 'jpg',
  avif: 'jpg',
  bmp: 'jpg',
  tiff: 'jpg',
};

/** Uploads one verified buffer to Cloudinary; the public_id is generated server-side. */
const uploadToCloudinary = (buffer: Buffer, type: SupportedImageType): Promise<UploadApiResponse> =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        resource_type: 'image',
        format: FORMAT_BY_TYPE[type],
        // No client filename is used — Cloudinary generates the public_id.
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary upload failed'));
          return;
        }
        resolve(result);
      },
    );
    uploadStream.end(buffer);
  });

/**
 * Deletes a Cloudinary asset. Failures are logged (public_id only, never
 * credentials) and never thrown, so admin actions are not blocked.
 */
export const destroyImageAsset = async (publicId: string): Promise<void> => {
  if (!isCloudinaryConfigured) {
    return;
  }
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
  } catch (error) {
    console.error(
      `Cloudinary delete failed (public_id=${publicId}):`,
      error instanceof Error ? error.message : error,
    );
  }
};

/** Best-effort cleanup helper for several assets at once. */
export const destroyImageAssets = async (publicIds: Array<string | null>): Promise<void> => {
  for (const publicId of publicIds) {
    if (publicId) {
      await destroyImageAsset(publicId);
    }
  }
};

/**
 * Validates buffered images (magic bytes), uploads them to Cloudinary and
 * returns the secure URL + public_id for each. Nothing touches local disk.
 */
export const saveImages = async (files: Express.Multer.File[]): Promise<ImageAsset[]> => {
  // Validate content first (cheap, deterministic) so bad files are rejected
  // with a 400 even when the storage backend is not configured.
  const detected: Array<{ buffer: Buffer; type: SupportedImageType }> = [];
  for (const file of files) {
    const type = detectImageType(file.buffer);
    if (!type) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'File content is not a supported image (jpeg, png, webp, heic, avif, bmp or tiff)',
      );
    }
    detected.push({ buffer: file.buffer, type });
  }

  if (!isCloudinaryConfigured) {
    throw new AppError(500, 'SERVER_ERROR', 'Image storage is not configured');
  }

  const uploaded: ImageAsset[] = [];

  for (const { buffer, type } of detected) {
    try {
      const result = await uploadToCloudinary(buffer, type);
      uploaded.push({ url: result.secure_url, publicId: result.public_id });
    } catch (error) {
      // Roll back the assets uploaded in this batch so nothing is orphaned.
      await destroyImageAssets(uploaded.map((asset) => asset.publicId));
      console.error(
        'Cloudinary upload failed:',
        error instanceof Error ? error.message : error,
      );
      throw new AppError(502, 'SERVER_ERROR', 'Image upload failed. Please try again.');
    }
  }

  return uploaded;
};

