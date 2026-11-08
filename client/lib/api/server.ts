import { cacheLife } from 'next/cache';
import { NEW_BADGE_WINDOW_MS } from '@/lib/catalog/new-badge';
import type { CategoryTreeItem, ListEnvelope, ProductCard, ProductDetail } from '@/lib/types';

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

