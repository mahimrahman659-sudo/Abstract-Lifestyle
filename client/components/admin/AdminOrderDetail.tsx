'use client';

import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { ProductImage } from '@/components/catalog/ProductCard';
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { AdminOrderDetail as AdminOrderDetailData, OrderStatus } from '@/lib/types';

const NEXT_STEPS: Record<
  OrderStatus,
  Array<{ status: OrderStatus; label: string; variant: 'primary' | 'secondary' | 'danger'; cancel?: boolean }>
> = {
  pending: [
    { status: 'processing', label: 'Mark as processing', variant: 'primary' },
    { status: 'cancelled', label: 'Cancel order', variant: 'danger', cancel: true },
  ],
  processing: [
    { status: 'shipped', label: 'Mark as shipped', variant: 'primary' },
    { status: 'cancelled', label: 'Cancel order', variant: 'danger', cancel: true },
  ],
  shipped: [{ status: 'delivered', label: 'Mark as delivered', variant: 'primary' }],
  delivered: [],
  cancelled: [],
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: AdminOrderDetailData };

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function AdminOrderDetail({ orderId }: { orderId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState((previous) => (previous.status === 'success' ? previous : { status: 'loading' }));
      try {
        const data = await adminApi.getOrder(orderId);
        if (!cancelled) {
          setState({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load this order.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadKey]);

  const transition = (status: OrderStatus) => {
    if (state.status !== 'success') {
      return;
    }
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.updateOrderStatus(orderId, status);
        const fresh = await adminApi.getOrder(orderId);
        setState({ status: 'success', data: fresh });
        setNotice({
          tone: 'success',
          message:
            status === 'cancelled'
              ? 'Order cancelled. Reserved stock has been restored.'
              : `Order status updated to “${status}”.`,
        });
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof ApiError ? error.message : 'Could not update the order status.',
        });
        setReloadKey((key) => key + 1);
      } finally {
        setBusy(false);
        setCancelOpen(false);
      }
    })();
  };

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="Could not load this order"
        description={state.message}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  const { order, customer } = state.data;
  const steps = NEXT_STEPS[order.status];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Order {order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} />
        <span className="text-xs text-muted">
          {formatDate(order.createdAt)} · Cash on Delivery ({order.paymentStatus})
        </span>
      </header>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <section aria-labelledby="customer-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="customer-heading" className="text-base font-semibold text-ink">
          Customer
        </h2>
        {customer ? (
          <p className="mt-2 text-sm text-ink">
            {customer.name}
            <span className="ml-2 text-muted">{customer.email}</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Customer account no longer exists.</p>
        )}
      </section>

      <section aria-labelledby="admin-items-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="admin-items-heading" className="text-base font-semibold text-ink">
          Items
        </h2>
        <ul className="mt-4 space-y-4">
          {order.items.map((item) => (
            <li key={item.variant} className="flex items-center gap-4">
              <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-paper">
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

      <section aria-labelledby="admin-address-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="admin-address-heading" className="text-base font-semibold text-ink">
          Shipping address
        </h2>
        <address className="mt-2 text-sm not-italic text-muted">
          <span className="font-medium text-ink">{order.shippingAddress.fullName}</span>
          <br />
          {order.shippingAddress.line1}
          {order.shippingAddress.line2 ? <>, {order.shippingAddress.line2}</> : null}
          <br />
          {order.shippingAddress.city}
          {order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ''}{' '}
          {order.shippingAddress.postalCode ?? ''}
          <br />
          {order.shippingAddress.country} · {order.shippingAddress.phone}
        </address>
      </section>

      <section aria-labelledby="admin-status-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="admin-status-heading" className="text-base font-semibold text-ink">
          Status
        </h2>
        {steps.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {order.status === 'delivered'
              ? 'This order is delivered — no further transitions.'
              : 'This order is cancelled — no further transitions.'}
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              Only valid next steps are shown (pending → processing → shipped → delivered; cancel from
              pending or processing).
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {steps.map((step) =>
                step.cancel ? (
                  <Button
                    key={step.status}
                    variant="danger"
                    disabled={busy}
                    onClick={() => setCancelOpen(true)}
                  >
                    {step.label}
                  </Button>
                ) : (
                  <Button
                    key={step.status}
                    variant={step.variant}
                    disabled={busy}
                    loading={busy}
                    onClick={() => transition(step.status)}
                  >
                    {step.label}
                  </Button>
                ),
              )}
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="admin-history-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="admin-history-heading" className="text-base font-semibold text-ink">
          Status history
        </h2>
        <ol className="mt-3 space-y-2 text-sm text-muted">
          {order.statusHistory.map((entry) => (
            <li key={`${entry.status}-${entry.at}`}>
              <span className="font-medium text-ink">{entry.status}</span> — {formatDate(entry.at)}
            </li>
          ))}
        </ol>
      </section>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this order?"
        message="Stock reserved by this order will be restored. This cannot be undone."
        confirmLabel="Yes, cancel order"
        busy={busy}
        onConfirm={() => transition('cancelled')}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}