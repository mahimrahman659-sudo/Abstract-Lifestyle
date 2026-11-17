import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isLoopbackHostname, resolveSiteUrl } from '../site-url.ts';

const PROD = { nodeEnv: 'production' as const };

describe('A4 — public site URL guard', () => {
  it('accepts an explicit https origin in production', () => {
    const url = resolveSiteUrl({ ...PROD, raw: 'https://abstract-lifestyle.vercel.app' });
    assert.equal(url.origin, 'https://abstract-lifestyle.vercel.app');
  });

  it('rejects a missing value in production', () => {
    assert.throws(() => resolveSiteUrl({ ...PROD }), /NEXT_PUBLIC_SITE_URL is required/);
  });

  it('rejects localhost in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'http://localhost:3000' }),
      /must use https in production/,
    );
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://localhost:3000' }),
      /must not point at a local host/,
    );
  });

  it('rejects loopback IPs in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://127.0.0.1' }),
      /must not point at a local host/,
    );
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://[::1]:3000' }),
      /must not point at a local host/,
    );
  });

  it('rejects plain http in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'http://abstract-lifestyle.vercel.app' }),
      /must use https in production/,
    );
  });

  it('rejects a relative/non-absolute value everywhere', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'abstract-lifestyle.vercel.app' }),
      /must be an absolute URL/,
    );
    assert.throws(
      () => resolveSiteUrl({ nodeEnv: 'development', raw: '/products' }),
      /must be an absolute URL/,
    );
  });

  it('allows localhost in development and defaults to it', () => {
    assert.equal(resolveSiteUrl({ nodeEnv: 'development' }).origin, 'http://localhost:3000');
    assert.equal(
      resolveSiteUrl({ nodeEnv: 'development', raw: 'http://localhost:3000' }).origin,
      'http://localhost:3000',
    );
  });

  it('uses the Vercel preview origin when no explicit value is set', () => {
    const url = resolveSiteUrl({
      nodeEnv: 'production',
      vercelEnv: 'preview',
      vercelUrl: 'abstract-lifestyle-git-branch.vercel.app',
    });
    assert.equal(url.origin, 'https://abstract-lifestyle-git-branch.vercel.app');
  });

  it('accepts an explicit https value on preview deployments', () => {
    const url = resolveSiteUrl({
      nodeEnv: 'production',
      vercelEnv: 'preview',
      raw: 'https://abstract-lifestyle-git-branch.vercel.app',
    });
    assert.equal(url.origin, 'https://abstract-lifestyle-git-branch.vercel.app');
  });

  it('rejects an explicit localhost preview origin', () => {
    assert.throws(
      () =>
        resolveSiteUrl({
          nodeEnv: 'production',
          vercelEnv: 'preview',
          raw: 'http://localhost:3000',
        }),
      /must use https in production/,
    );
    assert.throws(
      () =>
        resolveSiteUrl({
          nodeEnv: 'production',
          vercelEnv: 'preview',
          raw: 'https://localhost:3000',
        }),
      /must not point at a local host/,
    );
  });

  it('rejects an explicit loopback preview origin', () => {
    for (const host of ['127.0.0.1', '127.2.3.4', '[::1]', '[::ffff:127.0.0.1]', 'app.localhost', 'localhost.']) {
      assert.throws(
        () => resolveSiteUrl({ ...PROD, vercelEnv: 'preview', raw: `https://${host}` }),
        /must not point at a local host/,
      );
    }
  });

  it('rejects explicit non-HTTPS origins in previews even with a valid fallback', () => {
    for (const raw of ['http://example.vercel.app', 'ftp://example.vercel.app']) {
      assert.throws(
        () => resolveSiteUrl({ ...PROD, vercelEnv: 'preview', vercelUrl: 'valid.vercel.app', raw }),
        /must use https/,
      );
    }
  });

  it('rejects unsafe or missing inferred preview origins', () => {
    for (const vercelUrl of ['', 'localhost', '127.1.2.3', '[::1]', 'http://example.vercel.app']) {
      assert.throws(() => resolveSiteUrl({ ...PROD, vercelEnv: 'preview', vercelUrl }), /is required/);
    }
  });

  it('keeps canonical production configuration mandatory despite VERCEL_URL', () => {
    assert.throws(() => resolveSiteUrl({ ...PROD, vercelEnv: 'production', vercelUrl: 'branch.vercel.app' }), /is required/);
  });

  it('fails a preview with no explicit value and no VERCEL_URL', () => {
    assert.throws(
      () =>
        resolveSiteUrl({
          nodeEnv: 'production',
          vercelEnv: 'preview',
        }),
      /is required in production/,
    );
  });

  it('classifies loopback hosts', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '0.0.0.0', '::1', 'app.localhost']) {
      assert.equal(isLoopbackHostname(host), true, host);
    }
    for (const host of ['abstract-lifestyle.vercel.app', 'example.com', '10.0.0.5']) {
      assert.equal(isLoopbackHostname(host), false, host);
    }
  });
});

describe('A4 — consumers use the guarded origin', () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), 'utf8');

  it('seo.ts resolves SITE_URL through resolveSiteUrl and derives absoluteUrl from it', () => {
    const source = read('../seo.ts');
    assert.match(source, /resolveSiteUrl\(/);
    assert.match(source, /export const SITE_URL/);
    assert.match(source, /export const absoluteUrl/);
    assert.doesNotMatch(source, /'http:\/\/localhost:3000'/);
  });

  it('canonical/OG metadata, robots and sitemap all import from lib/seo', () => {
    for (const file of ['../../app/layout.tsx', '../../app/sitemap.ts', '../../app/robots.ts']) {
      const source = read(file);
      assert.match(source, /@\/lib\/seo/, `${file} must use the guarded SEO helpers`);
    }
  });

  it('builds absolute canonical/robots/sitemap URLs from the resolved origin', () => {
    const origin = resolveSiteUrl({ ...PROD, raw: 'https://abstract-lifestyle.vercel.app' });
    assert.equal(new URL('/sitemap.xml', origin).toString(), 'https://abstract-lifestyle.vercel.app/sitemap.xml');
    assert.equal(new URL('/products/mens-pant', origin).toString(), 'https://abstract-lifestyle.vercel.app/products/mens-pant');
  });
});
