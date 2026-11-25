'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { AdminCustomer, ListEnvelope } from '@/lib/types';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ListEnvelope<AdminCustomer> };

/** `/admin/customers` — searchable customer list linking to activity timelines. */
export function CustomerList() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const data = await adminApi.listCustomers({
          search: search || undefined,
          page,
          limit: 20,
        });
        if (!cancelled) {
          setState({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load customers.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search, page, reloadKey]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Customers</h1>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <Input
          id="customer-search"
          label="Search"
          hint="By name or e-mail."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          maxLength={100}
        />
        <Button type="submit">Search</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSearchInput('');
            setSearch('');
            setPage(1);
          }}
        >
          Clear
        </Button>
      </form>

      {state.status === 'loading' ? (
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : state.status === 'error' ? (
        <ErrorState
          title="Customers unavailable"
          description={state.message}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : state.data.items.length === 0 ? (
        <EmptyState title="No customers found" description="Try a different search." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((customer) => (
                  <tr key={customer.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{customer.name}</td>
                    <td className="px-4 py-3 text-muted">{customer.email}</td>
                    <td className="px-4 py-3 capitalize text-muted">{customer.role}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(customer.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="text-brand hover:underline"
                      >
                        View timeline
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={state.data.page}
            totalPages={state.data.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
