import Image from 'next/image';
import Link from 'next/link';
import { Price } from '@/components/ui/Price';
import type { ProductCard as ProductCardData } from '@/lib/types';

/** Neutral placeholder shown when a product has no image. */
export function ProductImage({ src, name }: { src: string | null; name: string }) {
  if (!src) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-paper text-muted"
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
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
      className="object-cover"
    />
  );
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-paper">
        <ProductImage src={product.image} name={product.name} />
        {!product.inStock ? (
          <span className="absolute left-3 top-3 rounded-full bg-ink/80 px-2.5 py-1 text-xs font-medium text-white">
            Out of stock
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 py-3">
        {product.category ? (
          <p className="text-xs uppercase tracking-wide text-muted">{product.category.name}</p>
        ) : null}
        <h3 className="text-sm font-medium text-ink group-hover:underline">{product.name}</h3>
        <p className="mt-auto pt-2 text-sm font-semibold text-ink">
          {product.priceFrom === product.priceTo ? (
            <Price poisha={product.priceFrom} />
          ) : (
            <>
              From <Price poisha={product.priceFrom} />
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
