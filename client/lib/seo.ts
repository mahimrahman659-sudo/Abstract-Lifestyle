/** Single source of truth for the public site URL and shared SEO defaults. */
export const SITE_URL = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');

export const SITE_NAME = 'Abstract Lifestyle';

export const SITE_DESCRIPTION =
  'Clothing and everyday lifestyle essentials, designed simply. Shop tees, hoodies, bags, bottles and more.';

/** Turns a relative path (e.g. /uploads/x.png) into an absolute URL. */
export const absoluteUrl = (path: string): string => new URL(path, SITE_URL).toString();
