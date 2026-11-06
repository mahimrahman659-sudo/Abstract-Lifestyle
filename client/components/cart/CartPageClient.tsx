'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { GuestCartLine, ServerCartLine } from '@/components/cart/CartLine';
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

type GuestState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; lines: GuestCartLineView[] };

interface CartNotice {
  tone: NoticeTone;
  message: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';

export function CartPageClient() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { serverCart, guestItems, updateItem, removeItem, refresh } = useCart();
  const [guestState, setGuestState] = useState<GuestState>({ status: 'loading' });
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<CartNotice | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
          setNotice(
            finalQuantity < requested
              ? {
                  tone: 'info',
                  message: `Only ${finalQuantity} available — quantity set to ${finalQuantity}.`,
                }
              : null,
          );
        } else {
          setNotice(null);
        }
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error) });
      }
    });
  };

  const handleRemove = (variantId: string): void => {
    void withBusy(variantId, async () => {
      try {
        await removeItem(variantId);
        setNotice({ tone: 'success', message: 'Item removed from your cart.' });
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
        setNotice({
          tone: 'success',
          message: `Quantity updated to ${finalQuantity}.`,
        });
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error) });
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

  const skeletonRows = (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className="h-32 w-full rounded-2xl" />
      ))}
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

  const summary = (
    <aside className="rounded-2xl border border-line bg-surface p-5" aria-label="Order summary">
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
            <Button className="w-full" onClick={() => router.push('/login?next=/checkout')}>
              Sign in to check out
            </Button>
          </>
        ) : (
          <>
            {checkoutBlocked ? (
              <Notice tone="error" className="mb-3">
                Some items need attention before checkout. Fix or remove the flagged items above.
              </Notice>
            ) : null}
            <Button
              className="w-full"
              size="lg"
              disabled={checkoutBlocked || serverLines.length === 0}
              onClick={() => router.push('/checkout')}
            >
              Proceed to checkout
            </Button>
          </>
        )}
      </div>
    </aside>
  );

  if (authLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="mb-6 h-8 w-40" />
        {skeletonRows}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Your cart</h1>
      <p className="mt-1 text-sm text-muted">
        {itemCount} {itemCount === 1 ? 'item' : 'items'}
      </p>

      {notice ? (
        <Notice tone={notice.tone} className="mt-4">
          {notice.message}
        </Notice>
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
    </div>
  );
}
