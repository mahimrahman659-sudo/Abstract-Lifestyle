import { catalogApi } from '@/lib/api/catalog';
import type { GuestCartItem, GuestCartLineView } from '@/lib/types';

/**
 * Resolves guest cart lines (variantId + quantity only) to display lines using
 * the public catalog API. Prices always come from the server; unknown variants
 * are skipped, mirroring POST /cart/merge behavior.
 */
export const resolveGuestLines = async (items: GuestCartItem[]): Promise<GuestCartLineView[]> => {
  const { items: cards } = await catalogApi.getProducts({ limit: 50 });
  const details = await Promise.all(cards.map((card) => catalogApi.getProduct(card.slug)));

  const variantById = new Map<
    string,
    { name: string; slug: string; image: string | null; size: string | null; color: string | null; unitPrice: number }
  >();

  for (const detail of details) {
    for (const variant of detail.variants) {
      variantById.set(variant.id, {
        name: detail.product.name,
        slug: detail.product.slug,
        image: variant.images[0] ?? detail.product.images[0] ?? null,
        size: variant.size,
        color: variant.color,
        unitPrice: variant.price,
      });
    }
  }

  const lines: GuestCartLineView[] = [];
  for (const item of items) {
    const info = variantById.get(item.variantId);
    if (!info) {
      continue;
    }
    lines.push({
      variantId: item.variantId,
      quantity: item.quantity,
      ...info,
      lineTotal: info.unitPrice * item.quantity,
    });
  }
  return lines;
};
