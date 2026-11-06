import Link from 'next/link';
import { ProductCard } from '@/components/catalog/ProductCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchNewArrivals } from '@/lib/api/server';
import type { ListEnvelope, ProductCard as ProductCardData } from '@/lib/types';

async function loadArrivals(limit: number): Promise<ListEnvelope<ProductCardData> | null> {
  try {
    return await fetchNewArrivals(limit);
  } catch {
    return null;
  }
}

export async function NewArrivals({ limit = 8 }: { limit?: number }) {
  const data = await loadArrivals(limit);

  return (
    <section aria-labelledby="new-arrivals-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="new-arrivals-heading" className="text-xl font-semibold tracking-tight text-ink">
          New arrivals
        </h2>
        <Link
          href="/products?sort=newest"
          className="text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          View all
        </Link>
      </div>

      {data === null ? (
        <ErrorState
          title="Could not load new arrivals"
          description="Please refresh the page in a moment."
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="New products will appear here as soon as the catalog is stocked."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {data.items.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NewArrivalsSkeleton() {
  return (
    <section aria-hidden="true">
      <Skeleton className="mb-4 h-7 w-40" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="aspect-[4/5] w-full rounded-2xl" />
        ))}
      </div>
    </section>
  );
}
