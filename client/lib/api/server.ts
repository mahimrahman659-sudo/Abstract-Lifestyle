import type { ProductDetail } from '@/lib/types';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

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
