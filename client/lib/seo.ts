import { site } from '@/config/site';
import { resolveSiteUrl } from '@/lib/site-url';

/**
 * Single source of truth for the public site URL and shared SEO defaults.
 *
 * `resolveSiteUrl` refuses to fall back to localhost in a production build, so a
 * missing/misconfigured NEXT_PUBLIC_SITE_URL fails the deploy instead of shipping
 * localhost canonicals, OpenGraph URLs, robots.txt and sitemap entries.
 */
export const SITE_URL = resolveSiteUrl({
  raw: process.env.NEXT_PUBLIC_SITE_URL,
  nodeEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV,
  vercelUrl: process.env.VERCEL_URL,
});

export const SITE_NAME = site.name;

export const SITE_DESCRIPTION = site.description;

/** Turns a relative path (e.g. /uploads/x.png) into an absolute URL. */
export const absoluteUrl = (path: string): string => new URL(path, SITE_URL).toString();
