'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { GuestCartLine, ServerCartLine, type LineNotice } from '@/components/cart/CartLine';
import { useCart } from '@/components/cart/CartProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/client';
import { resolveGuestLines } from '@/lib/cart/guest-lines';
import type { GuestCartLineView } from '@/lib/types';

/** How long the "Removed — Undo" notice stays available. */
const UNDO_WINDOW_MS = 6000;

type GuestState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; lines: GuestCartLineView[] };

interface CartNotice {
  tone: NoticeTone;
  message: string;
}

interface UndoState {
  variantId: string;
  quantity: number;
  name: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';

export function CartPageClient() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { serverCart, guestItems, updateItem, removeItem, addItem, refresh } = useCart();
  const [guestState, setGuestState] = useState<GuestState>({ status: 'loading' });
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<CartNotice | null>(null);
  const [lineNotices, setLineNotices] = useState<Record<string, LineNotice>>({});
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The undo offer disappears after a few seconds so a stale re-add is impossible.
  useEffect(
    () => () => {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
    },
    [],
  );

  const isGuest = !authLoading && user === null;

  useEffect(() => {
    if (authLoading || user) {
      return;
    }
    const controller = new AbortController();

    void (async () => {
      await Promise.resolve();
      setGuestState({ status: 'loading' });
      try {
        const lines = await resolveGuestLines(guestItems);
        if (!controller.signal.aborted) {
          setGuestState({ status: 'success', lines });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setGuestState({ status: 'error', message: errorMessage(error) });
        }
      }
    })();

    return () => controller.abort();
  }, [authLoading, user, guestItems, reloadKey]);

  useEffect(() => {
    if (user) {
      void (async () => {
        await Promise.resolve();
        try {
          setServerError(null);
          await refresh();
        } catch (error) {
          setServerError(errorMessage(error));
        }
      })();
    }
  }, [user, refresh, reloadKey]);

  const setLineNotice = (variantId: string, value: LineNotice | null): void => {
    setLineNotices((previous) => {
      const next = { ...previous };
      if (value) {
        next[variantId] = value;
      } else {
        delete next[variantId];
      }
      return next;
    });
  };

  const withBusy = async (variantId: string, task: () => Promise<void>): Promise<void> => {
    setBusyIds((previous) => new Set(previous).add(variantId));
    try {
      await task();
    } finally {
      setBusyIds((previous) => {
        const next = new Set(previous);
        next.delete(variantId);
        return next;
      });
    }
  };

  const handleQuantityChange = (variantId: string, quantity: number): void => {
    if (!Number.isFinite(quantity)) {
      return;
    }
    const requested = Math.min(Math.max(1, Math.trunc(quantity)), 20);
    void withBusy(variantId, async () => {
      try {
        const cart = await updateItem(variantId, requested);
        if (cart) {
          const finalQuantity = cart.items.find((item) => item.variantId === variantId)?.quantity ?? 0;
          setLineNotice(
            variantId,
            finalQuantity < requested
              ? {
                  tone: 'info',
                  message: `Only ${finalQuantity} available — quantity set to ${finalQuantity}.`,
                }
              : null,
          );
        } else {
          setLineNotice(variantId, null);
        }
      } catch (error) {
        setLineNotice(variantId, { tone: 'error', message: errorMessage(error) });
      }
    });
  };

  /** Snapshot of a line (server or guest) used for the undo offer. */
  const lineFor = (variantId: string): { name: string; quantity: number } | null => {
    const serverLine = serverCart?.items.find((item) => item.variantId === variantId);
    if (serverLine) {
      return { name: serverLine.name ?? 'Item', quantity: serverLine.quantity };
    }
    const guestLine =
      guestState.status === 'success'
        ? guestState.lines.find((line) => line.variantId === variantId)
        : undefined;
    return guestLine ? { name: guestLine.name, quantity: guestLine.quantity } : null;
  };

  const handleRemove = (variantId: string): void => {
    const removed = lineFor(variantId);
    void withBusy(variantId, async () => {
      try {
        await removeItem(variantId);
        setLineNotice(variantId, null);
        setNotice(null);
        if (removed) {
          setUndo({ variantId, quantity: removed.quantity, name: removed.name });
          if (undoTimer.current) {
            clearTimeout(undoTimer.current);
          }
          undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
        }
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error) });
      }
    });
  };

  const handleUndo = (): void => {
    if (!undo) {
      return;
    }
    const { variantId, quantity } = undo;
    setUndo(null);
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    void withBusy(variantId, async () => {
      try {
        // Re-add through the existing endpoint so stock and prices stay server-side.
        await addItem(variantId, quantity);
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error) });
      }
    });
  };

  const handleFixQuantity = (variantId: string): void => {
    const line = serverCart?.items.find((item) => item.variantId === variantId);
    if (!line) {
      return;
    }
    void withBusy(variantId, async () => {
      try {
        const cart = await updateItem(variantId, line.quantity);
        const finalQuantity = cart?.items.find((item) => item.variantId === variantId)?.quantity ?? 0;
        setLineNotice(variantId, {
          tone: 'info',
          message: `Quantity updated to ${finalQuantity}.`,
        });
      } catch (error) {
        setLineNotice(variantId, { tone: 'error', message: errorMessage(error) });
      }
    });
  };

  const serverLines = serverCart?.items ?? [];
  const blockedLines = serverLines.filter(
    (item) => item.unavailable || item.outOfStock || item.insufficientStock,
  );
  const checkoutBlocked = !isGuest && blockedLines.length > 0;
  const itemCount = isGuest
    ? guestState.status === 'success'
      ? guestState.lines.reduce((sum, line) => sum + line.quantity, 0)
      : 0
    : serverLines.reduce((sum, item) => sum + item.quantity, 0);

  const canCheckout = !checkoutBlocked && serverLines.length > 0;

  /** Placeholder cards mirror the real line layout (image + text + stepper). */
  const skeletonRows = (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:flex-row"
        >
          <Skeleton className="size-20 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-11 w-40 rounded-lg" />
              <Skeleton className="h-11 w-24 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const skeletonSummary = (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-hidden="true">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-12 w-full rounded-full" />
    </div>
  );

  const emptyCart = (
    <EmptyState
      title="Your cart is empty"
      description="Browse the catalog and add something you like."
      action={
        <Link
          href="/products"
          className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Browse products
        </Link>
      }
    />
  );

  const guestSubtotal =
    guestState.status === 'success'
      ? guestState.lines.reduce((sum, line) => sum + line.lineTotal, 0)
      : 0;

  const cartTotal = isGuest ? guestSubtotal : (serverCart?.total ?? 0);

  const summary = (
    <aside
      className="h-fit rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-20"
      aria-label="Order summary"
    >
      <h2 className="text-sm font-semibold text-ink">Summary</h2>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="font-medium text-ink">
            <Price poisha={isGuest ? guestSubtotal : (serverCart?.subtotal ?? 0)} />
          </dd>
        </div>
        {!isGuest && serverCart ? (
          <>
            <div className="flex justify-between">
              <dt className="text-muted">Shipping</dt>
              <dd className="font-medium text-ink">
                <Price poisha={serverCart.shippingFee} />
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="font-semibold text-ink">
                <Price poisha={serverCart.total} />
              </dd>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted">Shipping is calculated at checkout after you sign in.</p>
        )}
      </dl>

      <div className="mt-5">
        {isGuest ? (
          <>
            <p className="mb-3 text-xs text-muted">
              Sign in to check out — your cart will be saved to your account automatically.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => router.push('/login?next=/checkout')}
            >
              Sign in to check out
            </Button>
          </>
        ) : (
          <>
            {checkoutBlocked ? (
              <p id="checkout-blocked-reason" className="mb-3 text-xs text-danger">
                Some items need attention before checkout. Fix or remove the flagged items above.
              </p>
            ) : null}
            <Button
              className="w-full"
              size="lg"
              disabled={!canCheckout}
              aria-describedby={checkoutBlocked ? 'checkout-blocked-reason' : undefined}
              onClick={() => router.push('/checkout')}
            >
              Proceed to checkout
            </Button>
          </>
        )}
      </div>
    </aside>
  );

  /** Mobile-only sticky checkout bar (the summary itself sits under the lines). */
  const mobileCheckoutBar = (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 lg:hidden">
      <div className="mx-auto flex max-w-6xl items-center gap-4">
        <div className="min-w-0">
          <p className="text-xs text-muted">Total</p>
          <p className="text-base font-semibold text-ink">
            <Price poisha={cartTotal} />
          </p>
        </div>
        {isGuest ? (
          <Button
            className="ml-auto min-h-11"
            onClick={() => router.push('/login?next=/checkout')}
          >
            Sign in to check out
          </Button>
        ) : (
          <Button
            className="ml-auto min-h-11"
            disabled={!canCheckout}
            aria-describedby={checkoutBlocked ? 'checkout-blocked-reason' : undefined}
            onClick={() => router.push('/checkout')}
          >
            Checkout
          </Button>
        )}
      </div>
    </div>
  );

  if (authLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="mb-6 h-8 w-40" />
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
          {skeletonRows}
          {skeletonSummary}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-32 sm:py-10 lg:pb-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Your cart</h1>
      <p className="mt-1 text-sm text-muted">
        {itemCount} {itemCount === 1 ? 'item' : 'items'}
      </p>

      {notice ? (
        <Notice tone={notice.tone} className="mt-4">
          {notice.message}
        </Notice>
      ) : null}

      {undo ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-tile px-4 py-3 text-sm text-ink"
        >
          <span>
            Removed {undo.name} from your cart.
          </span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={handleUndo}>
            Undo
          </Button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <section aria-label="Cart items">
          {isGuest ? (
            guestState.status === 'loading' ? (
              skeletonRows
            ) : guestState.status === 'error' ? (
              <ErrorState
                title="Could not load your cart"
                description={guestState.message}
                onRetry={() => setReloadKey((key) => key + 1)}
              />
            ) : guestState.lines.length === 0 ? (
              emptyCart
            ) : (
              <ul className="space-y-4">
                {guestState.lines.map((line) => (
                  <GuestCartLine
                    key={line.variantId}
                    line={line}
                    notice={lineNotices[line.variantId] ?? null}
                    actions={{
                      busy: busyIds.has(line.variantId),
                      onQuantityChange: handleQuantityChange,
                      onRemove: handleRemove,
                      onFixQuantity: handleFixQuantity,
                    }}
                  />
                ))}
              </ul>
            )
          ) : serverError ? (
            <ErrorState
              title="Could not load your cart"
              description={serverError}
              onRetry={() => setReloadKey((key) => key + 1)}
            />
          ) : serverCart === null ? (
            skeletonRows
          ) : serverLines.length === 0 ? (
            emptyCart
          ) : (
            <ul className="space-y-4">
              {serverLines.map((item) => (
                <ServerCartLine
                  key={item.variantId}
                  item={item}
                  notice={lineNotices[item.variantId] ?? null}
                  actions={{
                    busy: busyIds.has(item.variantId),
                    onQuantityChange: handleQuantityChange,
                    onRemove: handleRemove,
                    onFixQuantity: handleFixQuantity,
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        {summary}
      </div>

      {serverLines.length > 0 || (isGuest && guestState.status === 'success' && guestState.lines.length > 0)
        ? mobileCheckoutBar
        : null}
    </div>
  );
}
