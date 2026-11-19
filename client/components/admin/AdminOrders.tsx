'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { PaymentStatusBadge } from '@/components/orders/PaymentStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type {
  ListEnvelope,
  OrderDto,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils/cn';

const STATUSES: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATUSES: PaymentStatus[] = [
  'unpaid',
  'awaiting_payment',
  'pending_verification',
  'paid',
  'rejected',
  'refund_pending',
  'refunded',
  'cancelled',
];
const PAYMENT_METHODS: PaymentMethod[] = ['cod', 'bkash', 'nagad', 'rocket'];
const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cod: 'Cash on Delivery',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
};

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
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'' | PaymentStatus>('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<'' | PaymentMethod>('');
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
          search: search || undefined,
          status: statusFilter || undefined,
          paymentStatus: paymentStatusFilter || undefined,
          paymentMethod: paymentMethodFilter || undefined,
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
  }, [statusFilter, paymentStatusFilter, paymentMethodFilter, page, reloadKey, search]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Orders</h1>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault(); setPage(1); setSearch(searchInput.trim());
      }}>
        <Input id="order-search" label="Order number or customer phone" hint="Enter the complete order number or mobile number (+880 supported)." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={40} />
        <Button type="submit">Search</Button>
        <Button type="button" variant="secondary" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>Clear</Button>
      </form>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-order-status" className="text-sm font-medium text-ink">
            Fulfilment status
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-payment-status" className="text-sm font-medium text-ink">
            Payment status
          </label>
          <select
            id="admin-payment-status"
            value={paymentStatusFilter}
            onChange={(event) => {
              setPage(1);
              setPaymentStatusFilter(event.target.value as '' | PaymentStatus);
            }}
            className="h-11 w-48 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">All payment statuses</option>
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-payment-method" className="text-sm font-medium text-ink">
            Payment method
          </label>
          <select
            id="admin-payment-method"
            value={paymentMethodFilter}
            onChange={(event) => {
              setPage(1);
              setPaymentMethodFilter(event.target.value as '' | PaymentMethod);
            }}
            className="h-11 w-44 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_LABELS[method]}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={() => {
            setPage(1);
            setPaymentStatusFilter('pending_verification');
            setStatusFilter('');
          }}
        >
          Pending payment queue
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() => {
            setPage(1);
            setStatusFilter('');
            setPaymentStatusFilter('');
            setPaymentMethodFilter('');
          }}
        >
          Reset filters
        </Button>
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
                    <p className="text-xs font-medium text-ink">{order.shippingAddress.phone}</p>
                    <p className="text-xs text-muted">{order.shippingAddress.fullName}</p>
                    <p className="mt-1 text-xs text-muted">
                      {PAYMENT_LABELS[order.paymentMethod]} ·{' '}
                      {order.paymentStatus.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <PaymentStatusBadge status={order.paymentStatus} />
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
