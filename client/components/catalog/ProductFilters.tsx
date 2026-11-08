'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { buildCatalogQueryString, type CatalogQueryState } from '@/lib/catalog/query';
import type { CategoryTreeItem } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

export interface CatalogFacets {
  sizes: string[];
  colors: string[];
}

interface ProductFiltersProps {
  state: CatalogQueryState;
  categories: CategoryTreeItem[];
  facets: CatalogFacets;
}

const toTaka = (poisha: number | undefined): string =>
  poisha === undefined ? '' : String(poisha / 100);

const toPoisha = (value: string): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.round(parsed * 100);
};

export function ProductFilters({ state, categories, facets }: ProductFiltersProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minInput, setMinInput] = useState(toTaka(state.minPrice));
  const [maxInput, setMaxInput] = useState(toTaka(state.maxPrice));

  useEffect(() => {
    // Deferred into an async task (react-hooks/set-state-in-effect).
    void (async () => {
      await Promise.resolve();
      setMinInput(toTaka(state.minPrice));
      setMaxInput(toTaka(state.maxPrice));
    })();
  }, [state.minPrice, state.maxPrice]);

  const apply = (next: CatalogQueryState) => {
    router.push(`/products${buildCatalogQueryString({ ...next, page: 1 })}`);
  };

  const setCategory = (slug: string | undefined) => apply({ ...state, category: slug });

  const toggleValue = (field: 'sizes' | 'colors', value: string) => {
    const current = state[field];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    apply({ ...state, [field]: next });
  };

  const onPriceSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply({ ...state, minPrice: toPoisha(minInput), maxPrice: toPoisha(maxInput) });
  };

  const clearAll = () => router.push('/products');

  const categoryOption = (item: CategoryTreeItem, depth: number) => (
    <li key={item.id}>
      <label
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-tile',
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
          depth > 0 && 'ml-4',
        )}
      >
        <input
          type="radio"
          name="category"
          value={item.slug}
          checked={state.category === item.slug}
          onChange={() => setCategory(item.slug)}
          className="size-4 accent-accent"
        />
        <span className={state.category === item.slug ? 'font-medium text-ink' : 'text-muted'}>
          {item.name}
        </span>
      </label>
    </li>
  );

  return (
    <div className="lg:sticky lg:top-20">
      <Button
        variant="secondary"
        className="w-full lg:hidden"
        aria-expanded={open}
        aria-controls="catalog-filters"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide filters' : 'Show filters'}
      </Button>

      <div
        id="catalog-filters"
        className={cn('mt-4 space-y-6 lg:mt-0 lg:block', open ? 'block' : 'hidden')}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Category</legend>
          <ul className="space-y-0.5">
            <li>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-tile">
                <input
                  type="radio"
                  name="category"
                  checked={state.category === undefined}
                  onChange={() => setCategory(undefined)}
                  className="size-4 accent-accent"
                />
                <span
                  className={state.category === undefined ? 'font-medium text-ink' : 'text-muted'}
                >
                  All categories
                </span>
              </label>
            </li>
            {categories.map((root) => (
              <Fragment key={root.id}>
                {categoryOption(root, 0)}
                {root.children.map((child) => categoryOption(child, 1))}
              </Fragment>
            ))}
          </ul>
        </fieldset>

        <form onSubmit={onPriceSubmit}>
          <p className="mb-2 text-sm font-semibold text-ink">Price (৳)</p>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="filter-min-price">
              Minimum price
            </label>
            <input
              id="filter-min-price"
              inputMode="decimal"
              value={minInput}
              onChange={(event) => setMinInput(event.target.value)}
              placeholder="Min"
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <span aria-hidden="true" className="text-muted">
              –
            </span>
            <label className="sr-only" htmlFor="filter-max-price">
              Maximum price
            </label>
            <input
              id="filter-max-price"
              inputMode="decimal"
              value={maxInput}
              onChange={(event) => setMaxInput(event.target.value)}
              placeholder="Max"
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" className="mt-2 w-full">
            Apply price
          </Button>
        </form>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Size</legend>
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((size) => {
              const checked = state.sizes.includes(size);
              return (
                <label
                  key={size}
                  className={cn(
                    'cursor-pointer rounded-full border px-3 py-1.5 text-sm',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                    checked ? 'border-accent bg-accent text-white' : 'border-line text-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleValue('sizes', size)}
                  />
                  {size}
                </label>
              );
            })}
          </div>
          {facets.sizes.length === 0 ? (
            <p className="text-xs text-muted">No sizes available.</p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Color</legend>
          <div className="flex flex-wrap gap-2">
            {facets.colors.map((color) => {
              const checked = state.colors.includes(color);
              return (
                <label
                  key={color}
                  className={cn(
                    'cursor-pointer rounded-full border px-3 py-1.5 text-sm',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                    checked ? 'border-accent bg-accent text-white' : 'border-line text-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleValue('colors', color)}
                  />
                  {color}
                </label>
              );
            })}
          </div>
          {facets.colors.length === 0 ? (
            <p className="text-xs text-muted">No colors available.</p>
          ) : null}
        </fieldset>

        <Button variant="ghost" className="w-full" onClick={clearAll}>
          Clear all filters
        </Button>
      </div>
    </div>
  );
}