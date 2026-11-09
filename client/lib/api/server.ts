import { cacheLife } from 'next/cache';
import { NEW_BADGE_WINDOW_MS } from '@/lib/catalog/new-badge';
import type {
  AdminImageAsset,
  CategoryTreeItem,
  ListEnvelope,
  ProductCard,
  ProductDetail,
  SiteImage,
  SiteImageKey,
} from '@/lib/types';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Cutoff timestamp (ms) for the "New" badge.
 *
 * `Date.now()` cannot be read while a page is prerendering, so the snapshot is
 * taken inside a cached scope: the value is baked at build time and refreshed
 * on the same short cadence as the catalog data. The home page therefore stays
 * statically prerendered instead of being forced to render dynamically.
 */
export const getNewBadgeCutoff = async (): Promise<number> => {
  'use cache';
  cacheLife('minutes');
  return Date.now() - NEW_BADGE_WINDOW_MS;
};

/** Server-side fetch for the product detail page (dynamic, never cached). */
export const fetchProductDetail = async (slug: string): Promise<ProductDetail | null> => {
  const response = await fetch(`${API_URL}/api/products/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load product (status ${response.status})`);
  }

  return (await response.json()) as ProductDetail;
};

/** Home page: category tree (cached briefly, build-friendly). */
export const fetchCategoryTree = async (): Promise<CategoryTreeItem[]> => {
  const response = await fetch(`${API_URL}/api/categories`, { next: { revalidate: 60 } });
  if (!response.ok) {
    throw new Error(`Failed to load categories (status ${response.status})`);
  }
  const data = (await response.json()) as { items: CategoryTreeItem[] };
  return data.items;
};

/** Home page: newest products (cached briefly, build-friendly). */
export const fetchNewArrivals = async (limit = 8): Promise<ListEnvelope<ProductCard>> => {
  const response = await fetch(`${API_URL}/api/products?sort=newest&limit=${limit}`, {
    next: { revalidate: 60 },
  });
  if (!response.ok) {
    throw new Error(`Failed to load new arrivals (status ${response.status})`);
  }
  return (await response.json()) as ListEnvelope<ProductCard>;
};

/**
 * Storefront marketing image slots (hero, promo). Cached in a `'use cache'`
 * scope so the static home page can read it during prerender and pick up admin
 * uploads without a redeploy. Never throws — missing slots fall back to the
 * legacy /public images and then to placeholders.
 */
export const fetchSiteImages = async (): Promise<
  Partial<Record<SiteImageKey, AdminImageAsset | null>>
> => {
  'use cache';
  cacheLife('minutes');
  try {
    const response = await fetch(`${API_URL}/api/site-images`);
    if (!response.ok) {
      return {};
    }
    const data = (await response.json()) as { items: SiteImage[] };
    return Object.fromEntries(data.items.map((item) => [item.key, item.image])) as Partial<
      Record<SiteImageKey, AdminImageAsset | null>
    >;
  } catch {
    return {};
  }
};

/** Sitemap: category slugs with a safe fallback when the API is unavailable. */
export const fetchCategorySlugsForSitemap = async (): Promise<string[]> => {
  try {
    const tree = await fetchCategoryTree();
    const slugs: string[] = [];
    for (const root of tree) {
      slugs.push(root.slug);
      for (const child of root.children) {
        slugs.push(child.slug);
      }
    }
    return slugs;
  } catch {
    return [];
  }
};

/**
 * Related products for the product detail page: newest products in the same
 * category via the existing list endpoint, excluding the current product.
 * Never throws — related products must not break the page, so any error (API
 * down, bad response) yields an empty array.
 */
export const getRelatedProducts = async (
  categorySlug: string,
  excludeSlug: string,
): Promise<ProductCard[]> => {
  if (!categorySlug) {
    return [];
  }
  try {
    const response = await fetch(
      `${API_URL}/api/products?category=${encodeURIComponent(categorySlug)}&sort=newest&limit=5`,
      { next: { revalidate: 60 } },
    );
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as ListEnvelope<ProductCard>;
    return data.items.filter((item) => item.slug !== excludeSlug).slice(0, 4);
  } catch {
    return [];
  }
};

