import Image from 'next/image';
import Link from 'next/link';
import { CartIcon } from '@/components/ui/icons';
import { Price } from '@/components/ui/Price';
import type { ProductCard as ProductCardData } from '@/lib/types';

const NEW_BADGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** "New" only when the API returned createdAt and it is within 14 days. */
const isRecentlyCreated = (createdAt?: string): boolean => {
  if (!createdAt) {
    return false;
  }
  const created = new Date(createdAt).getTime();
  return !Number.isNaN(created) && Date.now() - created < NEW_BADGE_DAYS * DAY_MS;
};

export interface ProductImageProps {
  src: string | null;
  name: string;
  /** Extra classes for the img (e.g. object-contain padding). */
  className?: string;
  sizes?: string;
}

/** Neutral placeholder shown when a product has no image. */
export function ProductImage({ src, name, className = '', sizes }: ProductImageProps) {
  if (!src) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-tile text-muted ${className}`}
        role="img"
        aria-label={`No image available for ${name}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 fill-none stroke-current" strokeWidth="1.2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m5 17 4-4 3 3 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={name}
      fill
      sizes={sizes ?? '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw'}
      className={`object-cover ${className}`}
    />
  );
}

export function ProductCard({ product }: { product: ProductCardData }) {
  const href = `/products/${product.slug}`;

  return (
    <article className="group flex flex-col">
      <Link href={href} className={`block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}>
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-tile">
          <ProductImage
            src={product.image}
            name={product.name}
            className="object-contain p-2"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          />
          {isRecentlyCreated(product.createdAt) ? (
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
        <h3 className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-ink group-hover:underline">
          {product.name}
        </h3>
      </Link>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-[14px] font-bold text-ink">
          {product.priceFrom === product.priceTo ? (
            <Price poisha={product.priceFrom} />
          ) : (
            <>
              From <Price poisha={product.priceFrom} />
            </>
          )}
        </p>
        <Link
          href={href}
          aria-label="View options"
          className={`flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-tile ${focusClass}`}
        >
          <CartIcon className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
