import multer from 'multer';
import { AppError } from './error-handler.js';

export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;

/** Memory storage so file content can be verified before anything touches disk. */
export const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (_req, file, callback) => {
    // The browser MIME type is only a hint (renamed files report the extension's
    // type, unknown ones report octet-stream or nothing). Unknown/image types
    // pass here — the real gate is the magic-byte content check in upload.service.
    const mime = (file.mimetype ?? '').toLowerCase();
    const looksImage = !mime || mime === 'application/octet-stream' || mime.startsWith('image/');
    if (!looksImage) {
      callback(new AppError(400, 'VALIDATION_ERROR', 'Only image files are allowed'));
      return;
    }
    callback(null, true);
  },
}).array('images', MAX_UPLOAD_FILES);
