import Image from 'next/image';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchCategoryTree } from '@/lib/api/server';
import type { CategoryTreeItem } from '@/lib/types';

function CategoryCard({ category }: { category: CategoryTreeItem }) {
  const childNames = category.children.map((child) => child.name).join(' · ');

  return (
    <li>
      <Link
        href={`/products?category=${category.slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="relative flex aspect-[16/10] items-center justify-center bg-tile">
          {category.image ? (
            <Image
              src={category.image}
              alt={category.name}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover"
            />
          ) : (
            <span aria-hidden="true" className="text-3xl font-semibold tracking-tight text-muted">
              {category.name.slice(0, 1)}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-4 py-3">
          <h3 className="text-sm font-medium text-ink group-hover:underline">{category.name}</h3>
          {childNames ? <p className="text-xs text-muted">{childNames}</p> : null}
        </div>
      </Link>
    </li>
  );
}

export async function FeaturedCategories() {
  let categories: CategoryTreeItem[];
  try {
    categories = await fetchCategoryTree();
  } catch {
    return (
      <section aria-labelledby="featured-categories-heading">
        <h2 id="featured-categories-heading" className="mb-4 text-xl font-semibold tracking-tight text-ink">
          Shop by category
        </h2>
        <ErrorState
          title="Could not load categories"
          description="Please refresh the page in a moment."
        />
      </section>
    );
  }

  const featured = categories.slice(0, 4);

  return (
    <section aria-labelledby="featured-categories-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="featured-categories-heading" className="text-xl font-semibold tracking-tight text-ink">
          Shop by category
        </h2>
        <Link
          href="/products"
          className="text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          View all
        </Link>
      </div>
      {featured.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Categories will appear here once the catalog is set up."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {featured.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FeaturedCategoriesSkeleton() {
  return (
    <section aria-hidden="true">
      <Skeleton className="mb-4 h-7 w-48" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-52 w-full rounded-2xl" />
        ))}
      </div>
    </section>
  );
}
