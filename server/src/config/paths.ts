import { fileURLToPath } from 'node:url';

/** Absolute path of /server/uploads (product images). */
export const UPLOADS_DIR = fileURLToPath(new URL('../../uploads/', import.meta.url));
