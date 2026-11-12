import { ProductCard } from '@/components/catalog/ProductCard';
import { SectionHeading } from '@/components/home/SectionHeading';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchNewArrivals, getNewBadgeCutoff } from '@/lib/api/server';
import { isCreatedAfter } from '@/lib/catalog/new-badge';
import { PRODUCT_GRID_CLASS, PRODUCT_GRID_ITEM_CLASS } from '@/lib/catalog/grid';
import { site } from '@/config/site';
import type { ListEnvelope, ProductCard as ProductCardData } from '@/lib/types';

const LIMIT = 5;

const head = () => ({
  id: 'new-arrivals-heading',
  title: site.sections.newArrivals.title,
  linkLabel: site.sections.newArrivals.linkLabel,
  href: site.sections.newArrivals.href,
});

async function loadArrivals(): Promise<ListEnvelope<ProductCardData> | null> {
  try {
    return await fetchNewArrivals(LIMIT);
  } catch {
    return null;
  }
}

export async function NewArrivals() {
  const data = await loadArrivals();
  // Cached snapshot of "now"; read once per render so every card agrees.
  const newCutoff = await getNewBadgeCutoff();

  return (
    <section aria-labelledby="new-arrivals-heading">
      <SectionHeading {...head()} />
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
        <ul className={PRODUCT_GRID_CLASS}>
          {data.items.map((product) => (
            <li key={product.id} className={PRODUCT_GRID_ITEM_CLASS}>
              <ProductCard product={product} isNew={isCreatedAfter(product.createdAt, newCutoff)} />
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
      <div className="mb-5 flex items-end justify-between gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className={PRODUCT_GRID_CLASS}>
        {Array.from({ length: LIMIT }).map((_, index) => (
          <div key={index} className={`${PRODUCT_GRID_ITEM_CLASS} flex flex-col`}>
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <Skeleton className="mt-1.5 h-4 w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}
