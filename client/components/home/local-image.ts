import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * True when a static image exists in /public. Server-only helper so the home
 * page can fall back to a neutral placeholder without crashing when a marketing
 * image (hero.jpg, promo-*.jpg) has not been added yet.
 */
export const hasPublicImage = (file: string): boolean =>
  existsSync(join(process.cwd(), 'public', file));
