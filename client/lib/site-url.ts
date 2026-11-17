/**
 * Public-origin resolution for metadata, canonicals, OpenGraph, robots and the
 * sitemap. Pure on purpose (no framework imports) so it is unit-testable and can
 * run both at build time and at runtime.
 *
 * Production builds must provide an explicit absolute **https** URL that is not a
 * loopback host. Silently falling back to `http://localhost:3000` would publish
 * localhost canonicals to search engines — the exact failure this guard exists
 * to prevent. Development keeps the convenient localhost default.
 */

export interface SiteUrlInputs {
  /** NEXT_PUBLIC_SITE_URL as provided by the environment. */
  raw?: string | undefined;
  /** NODE_ENV. */
  nodeEnv?: string | undefined;
  /** VERCEL_ENV ("production" | "preview" | "development") when on Vercel. */
  vercelEnv?: string | undefined;
  /** VERCEL_URL (hostname only, no protocol) when on Vercel. */
  vercelUrl?: string | undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') ||
    host.startsWith('127.') || /^::ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(host);
};

const parseAbsoluteUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const REQUIREMENT =
  'Set NEXT_PUBLIC_SITE_URL to the public origin (for example https://abstract-lifestyle.vercel.app) before building for production.';

/**
 * Resolves the public origin or throws with an actionable message.
 *
 * - any production build (`NODE_ENV=production`, which includes Vercel Preview):
 *   an explicit value must be absolute **https** and must not be a loopback host;
 * - Vercel preview with no explicit value: falls back to `https://$VERCEL_URL`,
 *   and fails if that is unavailable (never localhost);
 * - development/test (`NODE_ENV!==production`): localhost default is allowed.
 */
export const resolveSiteUrl = (inputs: SiteUrlInputs): URL => {
  const raw = (inputs.raw ?? '').trim();
  const vercelEnv = (inputs.vercelEnv ?? '').trim();
  const isPreview = vercelEnv === 'preview';
  const strict = inputs.nodeEnv === 'production' || isPreview;

  if (raw.length > 0) {
    const parsed = parseAbsoluteUrl(raw);
    if (!parsed) {
      throw new Error(
        `NEXT_PUBLIC_SITE_URL must be an absolute URL (received "${raw}"). ${REQUIREMENT}`,
      );
    }
    if (strict) {
      if (parsed.protocol !== 'https:') {
        throw new Error(
          `NEXT_PUBLIC_SITE_URL must use https in production (received "${parsed.protocol}//"). ${REQUIREMENT}`,
        );
      }
      if (isLoopbackHostname(parsed.hostname)) {
        throw new Error(
          `NEXT_PUBLIC_SITE_URL must not point at a local host in production (received "${parsed.hostname}"). ${REQUIREMENT}`,
        );
      }
    }
    return parsed;
  }

  // No explicit value: a preview deployment uses its own https origin.
  if (isPreview) {
    const vercelUrl = (inputs.vercelUrl ?? '').trim();
    if (vercelUrl.length > 0) {
      const withProtocol = /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
      const parsed = parseAbsoluteUrl(withProtocol);
      if (parsed && parsed.protocol === 'https:' && !isLoopbackHostname(parsed.hostname)) {
        return parsed;
      }
    }
  }

  if (strict) {
    throw new Error(`NEXT_PUBLIC_SITE_URL is required in production. ${REQUIREMENT}`);
  }

  return new URL('http://localhost:3000');
};
