'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { ListEnvelope, OrderDto, OrderStatus } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

const STATUSES: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ListEnvelope<OrderDto> };

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function AdminOrders() {
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const data = await adminApi.listOrders({
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
            message: error instanceof ApiError ? error.message : 'Could not load orders.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, page, reloadKey]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Orders</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-order-status" className="text-sm font-medium text-ink">
            Status
          </label>
          <select
            id="admin-order-status"
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value as '' | OrderStatus);
            }}
            className="h-11 w-44 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status} className="capitalize">
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.status === 'loading' ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <ErrorState
          title="Could not load orders"
          description={state.message}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          title="No orders found"
          description="Orders will appear here once customers check out."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {state.data.items.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3',
                    'hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  )}
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{order.orderNumber}</p>
                    <p className="text-xs text-muted">
                      {formatDate(order.createdAt)} · {order.items.length} line
                      {order.items.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <OrderStatusBadge status={order.status} />
                    <span className="text-sm font-semibold text-ink">
                      <Price poisha={order.total} />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={state.data.page} totalPages={state.data.totalPages} onPageChange={setPage} />
          <p className="text-xs text-muted">{state.data.total} orders</p>
        </>
      )}
    </div>
  );
}
