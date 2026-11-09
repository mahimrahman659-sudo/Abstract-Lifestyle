import Image from 'next/image';
import Link from 'next/link';
import { SectionHeading } from '@/components/home/SectionHeading';
import { BagIcon, ShirtIcon, TagIcon } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchCategoryTree } from '@/lib/api/server';
import type { CategoryTreeItem } from '@/lib/types';
import { site } from '@/config/site';

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Soft tile tones so icon tiles read as designed, not as empty boxes. */
const TILE_TONES = ['bg-[#f2f0e8]', 'bg-[#edf1ea]', 'bg-[#f4f2ee]', 'bg-[#eef2f1]'];

/** Outline icon placeholder per category (no API changes needed). */
const categoryIcon = (category: CategoryTreeItem) => {
  const key = `${category.name} ${category.slug}`.toLowerCase();
  if (key.includes('shirt') || key.includes('hoodie') || key.includes('clothing')) {
    return ShirtIcon;
  }
  if (key.includes('bag') || key.includes('lifestyle')) {
    return BagIcon;
  }
  return TagIcon;
};

/** Roots first, then subcategories, capped at 8 tiles. */
const flattenCategories = (tree: CategoryTreeItem[]): CategoryTreeItem[] =>
  [...tree, ...tree.flatMap((root) => root.children)].slice(0, 8);

export async function ShopByCategory() {
  let categories: CategoryTreeItem[];
  try {
    categories = flattenCategories(await fetchCategoryTree());
  } catch {
    return (
      <section aria-labelledby="shop-by-category-heading">
        <SectionHeading {...head()} />
        <ErrorState title="Could not load categories" description="Please refresh the page in a moment." />
      </section>
    );
  }

  return (
    <section aria-labelledby="shop-by-category-heading">
      <SectionHeading {...head()} />
      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Collections will appear here once the catalog is set up."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          {categories.map((category, index) => {
            const Icon = categoryIcon(category);
            return (
              <li key={category.id}>
                <Link
                  href={`/products?category=${category.slug}`}
                  className={`group flex flex-col ${focusClass}`}
                >
                  <div
                    className={`relative aspect-[5/6] w-full overflow-hidden rounded-xl border border-line bg-surface transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-sm`}
                  >
                    {category.image ? (
                      <Image
                        src={category.image}
                        alt={category.name}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 12.5vw"
                        className="object-cover"
                      />
                    ) : (
                      <span
                        role="img"
                        aria-label={`${category.name} collection`}
                        className="flex h-full w-full items-center justify-center"
                      >
                        <span
                          className={`grid size-12 place-items-center rounded-full text-brand transition-transform duration-200 group-hover:scale-105 ${
                            TILE_TONES[index % TILE_TONES.length]
                          }`}
                        >
                          <Icon className="size-5" />
                        </span>
                      </span>
                    )}
                  </div>
                  <span className="mt-2.5 text-center text-[12px] font-semibold text-ink sm:text-[13px]">
                    {category.name}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const head = () => ({
  id: 'shop-by-category-heading',
  title: site.sections.categories.title,
  linkLabel: site.sections.categories.linkLabel,
  href: site.sections.categories.href,
});

export function ShopByCategorySkeleton() {
  return (
    <section aria-hidden="true">
      <div className="mb-5 flex items-end justify-between gap-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex flex-col items-center">
            <Skeleton className="aspect-[5/6] w-full rounded-lg" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}
