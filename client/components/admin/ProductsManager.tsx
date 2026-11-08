'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { catalogApi } from '@/lib/api/catalog';
import type { AdminProduct, ListEnvelope, ProductStatus } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ListEnvelope<AdminProduct> };

const STATUS_CLASSES: Record<ProductStatus, string> = {
  draft: 'border-line bg-tile text-muted',
  active: 'border-success/40 bg-success/10 text-success',
  archived: 'border-danger/40 bg-danger/10 text-danger',
};

export function ProductsManager() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | ProductStatus>('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .getCategories()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const names: Record<string, string> = {};
        for (const root of response.items) {
          names[root.id] = root.name;
          for (const child of root.children) {
            names[child.id] = `${root.name} / ${child.name}`;
          }
        }
        setCategoryNames(names);
      })
      .catch(() => {
        // Category names are cosmetic here; the table still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const data = await adminApi.listProducts({
          search: search || undefined,
          status: statusFilter || undefined,
          page,
          limit: 10,
        });
        if (!cancelled) {
          setState({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load products.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search, statusFilter, page, reloadKey]);

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Products</h1>
        <Link
          href="/admin/products/new"
          className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          New product
        </Link>
      </div>

      <form onSubmit={onSearch} role="search" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-product-search" className="text-sm font-medium text-ink">
            Search
          </label>
          <input
            id="admin-product-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Product name…"
            className="h-11 w-56 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-status-filter" className="text-sm font-medium text-ink">
            Status
          </label>
          <select
            id="admin-status-filter"
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value as '' | ProductStatus);
            }}
            className="h-11 w-40 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {state.status === 'loading' ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <ErrorState
          title="Could not load products"
          description={state.message}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          title="No products found"
          description="Try a different search or status filter."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Category</th>
                  <th scope="col" className="px-4 py-3">Price</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((product) => (
                  <tr key={product.id} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium text-ink">
                      {product.name}
                      <span className="block text-xs font-normal text-muted">/{product.slug}</span>
                    </th>
                    <td className="px-4 py-3 text-muted">{categoryNames[product.category] ?? '—'}</td>
                    <td className="px-4 py-3 text-ink">
                      <Price poisha={product.basePrice} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize',
                          STATUS_CLASSES[product.status],
                        )}
                      >
                        {product.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={state.data.page} totalPages={state.data.totalPages} onPageChange={setPage} />
          <p className="text-xs text-muted">{state.data.total} products</p>
        </>
      )}
    </div>
  );
}
