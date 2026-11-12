import Link from 'next/link';
import { ProductImage } from '@/components/catalog/ProductImage';
import { CartIcon } from '@/components/ui/icons';
import { Price } from '@/components/ui/Price';
import type { ProductCard as ProductCardData } from '@/lib/types';

// Kept re-exported so every existing `import { ProductImage } from ProductCard`
// keeps working after the fallback logic moved into its own client module.
export { ProductImage } from '@/components/catalog/ProductImage';
export type { ProductImageProps } from '@/components/catalog/ProductImage';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface ProductCardProps {
  product: ProductCardData;
  /**
   * "New" badge flag (created within the last 14 days), decided by the caller
   * from a stable cutoff instead of reading the clock during render. The home
   * list uses the cached server cutoff; the catalog listing derives it once when
   * its data arrives — so rendering stays pure and nothing becomes dynamic.
   */
  isNew: boolean;
}

export function ProductCard({ product, isNew }: ProductCardProps) {
  const href = `/products/${product.slug}`;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-shadow hover:shadow-sm">
      <Link href={href} className={`block ${focusClass}`}>
        <div className="relative aspect-square w-full overflow-hidden bg-tile">
          <ProductImage
            src={product.image}
            name={product.name}
            className="object-contain p-3"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          />
          {isNew ? (
            <span className="absolute left-2 top-2 rounded-[4px] bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              New
            </span>
          ) : null}
          {!product.inStock ? (
            <span className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-medium text-white">
              Out of stock
            </span>
          ) : null}
        </div>
      </Link>

      <div className="flex flex-1 items-end justify-between gap-2 p-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
            <Link href={href} className={`hover:underline ${focusClass}`}>
              {product.name}
            </Link>
          </h3>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-[14px] font-bold text-ink">
              {product.priceFrom === product.priceTo ? (
                <Price poisha={product.priceFrom} />
              ) : (
                <>
                  From <Price poisha={product.priceFrom} />
                </>
              )}
            </p>
            {product.discountPercent > 0 && product.compareAtPrice !== null ? (
              <>
                <s aria-label="Original price" className="text-[12px] text-muted line-through">
                  <Price poisha={product.compareAtPrice} />
                </s>
                <span className="rounded-[4px] bg-brand px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
                  −{product.discountPercent}%
                </span>
              </>
            ) : null}
          </div>
        </div>
        <Link
          href={href}
          aria-label="View options"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink transition-colors hover:border-ink hover:bg-tile ${focusClass}`}
        >
          <CartIcon className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
