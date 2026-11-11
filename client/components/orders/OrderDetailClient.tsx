'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProductImage } from '@/components/catalog/ProductCard';
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/client';
import { orderApi } from '@/lib/api/order';
import { site } from '@/config/site';
import type { OrderDto } from '@/lib/types';

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string; notFound: boolean }
  | { status: 'success'; order: OrderDto };

interface DetailNotice {
  tone: NoticeTone;
  message: string;
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [notice, setNotice] = useState<DetailNotice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const { order } = await orderApi.get(orderId);
        if (!cancelled) {
          setState({ status: 'success', order });
        }
      } catch (error) {
        if (!cancelled) {
          const notFound = error instanceof ApiError && error.status === 404;
          setState({
            status: 'error',
            notFound,
            message: notFound
              ? 'This order does not exist or does not belong to your account.'
              : error instanceof ApiError
                ? error.message
                : 'Could not load this order.',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, reloadKey]);

  const handleCancel = (): void => {
    setCancelling(true);
    setNotice(null);
    void (async () => {
      try {
        const { order } = await orderApi.cancel(orderId);
        setState({ status: 'success', order });
        setNotice({ tone: 'success', message: 'Order cancelled. Any reserved stock has been restored.' });
        setConfirming(false);
      } catch (error) {
        setNotice({
          tone: 'error',
          message:
            error instanceof ApiError && error.status === 409
              ? 'This order can no longer be cancelled.'
              : error instanceof ApiError
                ? error.message
                : 'Could not cancel this order.',
        });
        setConfirming(false);
        setReloadKey((key) => key + 1);
      } finally {
        setCancelling(false);
      }
    })();
  };

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <ErrorState
          title={state.notFound ? 'Order not found' : 'Could not load this order'}
          description={state.message}
          onRetry={state.notFound ? undefined : () => setReloadKey((key) => key + 1)}
        />
        <div>
          <Link
            href="/orders"
            className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Back to your orders
          </Link>
        </div>
      </div>
    );
  }

  const { order } = state;
  const address = order.shippingAddress;
  const canCancel = order.status === 'pending';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Order {order.orderNumber}
        </h1>
        <OrderStatusBadge status={order.status} />
      </header>
      <p className="text-sm text-muted">
        Placed on {formatDate(order.createdAt)} · Payment method: Cash on Delivery (
        {order.paymentStatus})
      </p>

      <p className="text-sm font-medium text-ink">
        {site.checkout.callConfirmation.replace('{phone}', address.phone)}
      </p>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <section
        aria-labelledby="order-items-heading"
        className="rounded-2xl border border-line bg-surface p-5"
      >
        <h2 id="order-items-heading" className="text-base font-semibold text-ink">
          Items
        </h2>
        <ul className="mt-4 space-y-4">
          {order.items.map((item) => (
            <li key={item.variant} className="flex items-center gap-4">
              <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-tile">
                <ProductImage src={item.image} name={item.name} />
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div>
                  <p className="text-sm font-medium text-ink">{item.name}</p>
                  <p className="text-xs text-muted">
                    {[item.size, item.color].filter(Boolean).join(' / ') || '—'} · SKU {item.sku} ·{' '}
                    <Price poisha={item.unitPrice} /> × {item.quantity}
                  </p>
                </div>
                <p className="text-sm font-semibold text-ink">
                  <Price poisha={item.lineTotal} />
                </p>
              </div>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="font-medium text-ink">
              <Price poisha={order.subtotal} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Shipping</dt>
            <dd className="font-medium text-ink">
              <Price poisha={order.shippingFee} />
            </dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base">
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="font-semibold text-ink">
              <Price poisha={order.total} />
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="order-address-heading"
        className="rounded-2xl border border-line bg-surface p-5"
      >
        <h2 id="order-address-heading" className="text-base font-semibold text-ink">
          Shipping address
        </h2>
        <address className="mt-3 text-sm not-italic text-muted">
          <span className="font-medium text-ink">{address.fullName}</span>
          <br />
          {address.line1}
          {address.line2 ? <>, {address.line2}</> : null}
          {address.city || address.state || address.postalCode ? (
            <>
              <br />
              {[address.city, address.state].filter(Boolean).join(', ')}
              {address.postalCode ? ` ${address.postalCode}` : ''}
            </>
          ) : null}
          {address.country ? (
            <>
              <br />
              {address.country}
            </>
          ) : null}
          <br />
          {address.phone}
        </address>
      </section>

      {canCancel ? (
        <section
          aria-labelledby="order-cancel-heading"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          <h2 id="order-cancel-heading" className="text-base font-semibold text-ink">
            Cancel order
          </h2>
          {confirming ? (
            <div className="mt-3 space-y-3">
              <Notice tone="info">
                Cancel this order? Any reserved stock will be restored. This cannot be undone.
              </Notice>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  loading={cancelling}
                  disabled={cancelling}
                  onClick={handleCancel}
                >
                  Yes, cancel order
                </Button>
                <Button
                  variant="secondary"
                  disabled={cancelling}
                  onClick={() => setConfirming(false)}
                >
                  Keep order
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-muted">
                Changed your mind? Pending orders can be cancelled and stock will be restored.
              </p>
              <Button variant="secondary" className="mt-3" onClick={() => setConfirming(true)}>
                Cancel order
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {order.statusHistory.length > 0 ? (
        <section
          aria-labelledby="order-history-heading"
          className="rounded-2xl border border-line bg-surface p-5"
        >
          <h2 id="order-history-heading" className="text-base font-semibold text-ink">
            Status history
          </h2>
          <ol className="mt-3 space-y-2 text-sm text-muted">
            {order.statusHistory.map((entry) => (
              <li key={`${entry.status}-${entry.at}`}>
                <span className="font-medium text-ink">{entry.status}</span> —{' '}
                {formatDate(entry.at)}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
