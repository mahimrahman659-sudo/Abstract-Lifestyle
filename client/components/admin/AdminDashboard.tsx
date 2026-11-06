'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { ErrorState } from '@/components/ui/ErrorState';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { AdminVariant, OrderDto, OrderStatus } from '@/lib/types';

const STATUSES: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

interface DashboardData {
  counts: Record<OrderStatus, number>;
  recentOrders: OrderDto[];
  lowStock: AdminVariant[];
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: DashboardData };

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const loadDashboard = async (): Promise<DashboardData> => {
  const [countResults, recent, lowStock] = await Promise.all([
    Promise.all(STATUSES.map((status) => adminApi.listOrders({ status, page: 1, limit: 1 }))),
    adminApi.listOrders({ page: 1, limit: 5 }),
    adminApi.listLowStockVariants(10),
  ]);

  const counts = STATUSES.reduce(
    (accumulator, status, index) => ({ ...accumulator, [status]: countResults[index].total }),
    {} as Record<OrderStatus, number>,
  );

  return { counts, recentOrders: recent.items, lowStock: lowStock.items };
};

export function AdminDashboard() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const data = await loadDashboard();
        if (!cancelled) {
          setState({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load the dashboard.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="Dashboard unavailable"
        description={state.message}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  const { counts, recentOrders, lowStock } = state.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>

      <section aria-label="Orders by status" className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {STATUSES.map((status) => (
          <div key={status} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">{status}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{counts[status]}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="recent-orders-heading"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          <div className="flex items-center justify-between">
            <h2 id="recent-orders-heading" className="text-base font-semibold text-ink">
              Recent orders
            </h2>
            <Link href="/admin/orders" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No orders yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {recentOrders.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {order.orderNumber}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {formatDate(order.createdAt)}
                    </span>
                  </Link>
                  <span className="flex items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <span className="font-medium text-ink">
                      <Price poisha={order.total} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="low-stock-heading"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          <h2 id="low-stock-heading" className="text-base font-semibold text-ink">
            Low stock
          </h2>
          {lowStock.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No variants are low on stock.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {lowStock.map((variant) => (
                <li key={variant.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">
                    {variant.product.name}
                    <span className="ml-2 text-xs text-muted">
                      {variant.sku}
                      {[variant.size, variant.color].filter(Boolean).length > 0
                        ? ` · ${[variant.size, variant.color].filter(Boolean).join(' / ')}`
                        : ''}
                    </span>
                  </span>
                  <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                    {variant.stock} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
