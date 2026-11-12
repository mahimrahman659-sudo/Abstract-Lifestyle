'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProductCard } from '@/components/catalog/ProductCard';
import { ProductFilters, type CatalogFacets } from '@/components/catalog/ProductFilters';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { catalogApi } from '@/lib/api/catalog';
import { ApiError } from '@/lib/api/client';
import { isCreatedAfter, NEW_BADGE_WINDOW_MS } from '@/lib/catalog/new-badge';
import { PRODUCT_GRID_CLASS, PRODUCT_GRID_ITEM_CLASS } from '@/lib/catalog/grid';
import { cn } from '@/lib/utils/cn';
import {
  buildCatalogQueryString,
  hasActiveCatalogFilters,
  parseCatalogQuery,
  PRODUCT_SORT_OPTIONS,
  toProductListParams,
} from '@/lib/catalog/query';
import type { CategoryTreeItem, ListEnvelope, ProductCard as ProductCardData, ProductSort } from '@/lib/types';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ListEnvelope<ProductCardData>; newCutoff: number };

const deriveFacets = (products: ProductCardData[]): CatalogFacets => {
  const sizes = new Set<string>();
  const colors = new Set<string>();
  for (const product of products) {
    product.sizes.forEach((size) => sizes.add(size));
    product.colors.forEach((color) => colors.add(color));
  }
  return {
    sizes: Array.from(sizes).sort(),
    colors: Array.from(colors).sort(),
  };
};

export function ProductsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const state = parseCatalogQuery(new URLSearchParams(queryKey));

  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [categories, setCategories] = useState<CategoryTreeItem[]>([]);
  const [facets, setFacets] = useState<CatalogFacets>({ sizes: [], colors: [] });
  const [searchInput, setSearchInput] = useState(state.search ?? '');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Deferred into an async task (react-hooks/set-state-in-effect).
    void (async () => {
      await Promise.resolve();
      setSearchInput(state.search ?? '');
    })();
  }, [state.search]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      await Promise.resolve();
      setList({ status: 'loading' });
      try {
        const data = await catalogApi.getProducts(toProductListParams(state), controller.signal);
        if (!controller.signal.aborted) {
          setList({ status: 'success', data, newCutoff: Date.now() - NEW_BADGE_WINDOW_MS });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setList({
          status: 'error',
          message: error instanceof ApiError ? error.message : 'Could not load products.',
        });
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([catalogApi.getCategories(), catalogApi.getProducts({ limit: 50 })])
      .then(([categoryResponse, facetResponse]) => {
        if (cancelled) {
          return;
        }
        setCategories(categoryResponse.items);
        setFacets(deriveFacets(facetResponse.items));
      })
      .catch(() => {
        // Filter facets are optional; keep the page usable without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { ...state, search: searchInput.trim().slice(0, 100) || undefined, page: 1 };
    router.push(`/products${buildCatalogQueryString(next)}`);
  };

  const onSortChange = (sort: ProductSort) => {
    router.push(`/products${buildCatalogQueryString({ ...state, sort, page: 1 })}`);
  };

  const goToPage = (page: number) => {
    router.push(`/products${buildCatalogQueryString({ ...state, page })}`);
  };

  const clearFilters = () => router.push('/products');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {state.search ? `Results for “${state.search}”` : 'All products'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {list.status === 'success'
              ? `${list.data.total} ${list.data.total === 1 ? 'product' : 'products'}`
              : 'Loading products…'}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <form role="search" onSubmit={onSearchSubmit} className="flex gap-2">
            <label htmlFor="catalog-search" className="sr-only">
              Search products
            </label>
            <input
              id="catalog-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search products…"
              className="h-10 w-full rounded-full border border-line bg-surface px-4 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-56"
            />
            <Button type="submit" variant="secondary" size="sm" className="h-10">
              Search
            </Button>
          </form>
          <div>
            <label htmlFor="catalog-sort" className="sr-only">
              Sort products
            </label>
            <select
              id="catalog-sort"
              value={state.sort}
              onChange={(event) => onSortChange(event.target.value as ProductSort)}
              className="h-10 w-full rounded-full border border-line bg-surface px-4 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-48"
            >
              {PRODUCT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside aria-label="Product filters">
          <ProductFilters state={state} categories={categories} facets={facets} />
        </aside>

        <section aria-label="Products" aria-busy={list.status === 'loading'}>
          {list.status === 'loading' ? (
            <div className={PRODUCT_GRID_CLASS}>
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className={cn(PRODUCT_GRID_ITEM_CLASS, 'overflow-hidden rounded-2xl border border-line bg-surface')}>
                  <Skeleton className="aspect-[4/5] w-full rounded-none" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : list.status === 'error' ? (
            <ErrorState
              title="Could not load products"
              description={list.message}
              onRetry={() => setReloadKey((key) => key + 1)}
            />
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No products found"
              description="Try adjusting your filters or search for something else."
              action={
                hasActiveCatalogFilters(state) ? (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <ul className={PRODUCT_GRID_CLASS}>
                {list.data.items.map((product) => (
                  <li key={product.id} className={PRODUCT_GRID_ITEM_CLASS}>
                    <ProductCard product={product} isNew={isCreatedAfter(product.createdAt, list.newCutoff)} />
                  </li>
                ))}
              </ul>
              <Pagination
                className="mt-10"
                page={list.data.page}
                totalPages={list.data.totalPages}
                onPageChange={goToPage}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}