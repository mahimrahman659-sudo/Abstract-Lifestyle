import multer from 'multer';
import { AppError } from './error-handler.js';

export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Memory storage so file content can be verified before anything touches disk. */
export const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(new AppError(400, 'VALIDATION_ERROR', 'Only jpeg, png and webp images are allowed'));
      return;
    }
    callback(null, true);
  },
}).array('images', MAX_UPLOAD_FILES);
