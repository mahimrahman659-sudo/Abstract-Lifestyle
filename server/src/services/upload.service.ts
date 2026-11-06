import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UPLOADS_DIR } from '../config/paths.js';
import { AppError } from '../middleware/error-handler.js';

type SupportedImageType = 'jpeg' | 'png' | 'webp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detects the real image type from file content (magic bytes), never from names. */
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
  return null;
};

const EXTENSION_BY_TYPE: Record<SupportedImageType, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

/** Saves verified images with random server-side names; returns public URLs. */
export const saveImages = async (files: Express.Multer.File[]): Promise<string[]> => {
  const urls: string[] = [];

  for (const file of files) {
    const type = detectImageType(file.buffer);
    if (!type) {
      throw new AppError(400, 'VALIDATION_ERROR', 'File content is not a jpeg, png or webp image');
    }

    const filename = `${randomUUID()}.${EXTENSION_BY_TYPE[type]}`;
    await writeFile(path.join(UPLOADS_DIR, filename), file.buffer);
    urls.push(`/uploads/${filename}`);
  }

  return urls;
};
