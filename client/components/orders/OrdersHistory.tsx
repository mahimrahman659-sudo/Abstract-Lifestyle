'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/client';
import { orderApi } from '@/lib/api/order';
import type { ListEnvelope, OrderDto } from '@/lib/types';

type OrdersState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ListEnvelope<OrderDto> };

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export function OrdersHistory() {
  const [state, setState] = useState<OrdersState>({ status: 'loading' });
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const data = await orderApi.list(page);
        if (!cancelled) {
          setState({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load your orders.',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, reloadKey]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Your orders</h1>
      <p className="mt-1 text-sm text-muted">Review past orders and track their status.</p>

      <div className="mt-6">
        {state.status === 'loading' ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : state.status === 'error' ? (
          <ErrorState
            title="Could not load your orders"
            description={state.message}
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        ) : state.data.items.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="When you place an order it will show up here."
            action={
              <Link
                href="/products"
                className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Browse products
              </Link>
            }
          />
        ) : (
          <>
            <ul className="space-y-4">
              {state.data.items.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/orders/${order.id}`}
                    className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        Order {order.orderNumber}
                        <span className="ml-2 text-xs font-normal text-muted">
                          {formatDate(order.createdAt)}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {order.items.reduce((sum, item) => sum + item.quantity, 0)}{' '}
                        {order.items.reduce((sum, item) => sum + item.quantity, 0) === 1
                          ? 'item'
                          : 'items'}
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
            <Pagination
              className="mt-8"
              page={state.data.page}
              totalPages={state.data.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
