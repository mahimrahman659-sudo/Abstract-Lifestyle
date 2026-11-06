'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AddressForm, type AddressFormErrors } from '@/components/checkout/AddressForm';
import { useCart } from '@/components/cart/CartProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/client';
import { orderApi, type CreateOrderPayload } from '@/lib/api/order';
import { userApi } from '@/lib/api/user';
import type { Address } from '@/lib/types';
import {
  cleanAddressPayload,
  validateAddress,
  type AddressFormValues,
} from '@/lib/validation/address';
import { fieldErrorsFromApi } from '@/lib/validation/server-errors';

type AddressesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; items: Address[] };

const emptyAddress: AddressFormValues = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'Bangladesh',
};

export function CheckoutClient() {
  const router = useRouter();
  const { serverCart, refresh } = useCart();

  // One idempotency key per checkout attempt: retries of this same form submit
  // reuse it, so the server can never create a duplicate order.
  const checkoutIdRef = useRef<string>('');

  const [addresses, setAddresses] = useState<AddressesState>({ status: 'loading' });
  const [selection, setSelection] = useState<string>('new');
  const [addressValues, setAddressValues] = useState<AddressFormValues>(emptyAddress);
  const [addressErrors, setAddressErrors] = useState<AddressFormErrors>({});
  const [saveAddress, setSaveAddress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      setAddresses({ status: 'loading' });
      try {
        const { items } = await userApi.getAddresses();
        if (!cancelled) {
          setAddresses({ status: 'success', items });
          if (items.length > 0 && selection === 'new') {
            const preferred = items.find((item) => item.isDefault) ?? items[0];
            setSelection(preferred._id);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setAddresses({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load your addresses.',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const onAddressChange = (field: keyof AddressFormValues, value: string): void => {
    setAddressValues((previous) => ({ ...previous, [field]: value }));
    setAddressErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setConflict(null);
    setRetryNote(null);

    if (!checkoutIdRef.current) {
      checkoutIdRef.current = crypto.randomUUID();
    }

    const payload: CreateOrderPayload = {
      checkoutId: checkoutIdRef.current,
      paymentMethod: 'cod',
    };

    if (selection === 'new') {
      const validation = validateAddress(addressValues);
      setAddressErrors(validation);
      if (Object.keys(validation).length > 0) {
        setFormError('Please fix the highlighted fields.');
        return;
      }
      payload.shippingAddress = cleanAddressPayload(addressValues);
    } else {
      payload.shippingAddressId = selection;
    }

    setSubmitting(true);
    try {
      const { order } = await orderApi.create(payload);

      if (selection === 'new' && saveAddress) {
        // Best-effort: the order is already placed if this fails.
        try {
          await userApi.createAddress({
            ...cleanAddressPayload(addressValues),
            isDefault: false,
          });
        } catch {
          // Ignore — the address can be saved again from the account flow.
        }
      }

      try {
        await refresh();
      } catch {
        // Cart is cleared server-side; the provider refreshes again on use.
      }
      router.push(`/orders/${order.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (
          error.message.includes('Item no longer available') ||
          error.message.includes('Insufficient stock')
        ) {
          setConflict(error.message);
        } else if (error.message.includes('Checkout already in progress')) {
          setRetryNote(
            'Checkout is already in progress. Please wait a moment and try again.',
          );
        } else if (error.message.includes('Cart is empty')) {
          setConflict('Your cart is empty.');
        } else {
          setFormError(error.message);
        }
      } else if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        setAddressErrors(fieldErrorsFromApi(error));
        setFormError('Please fix the highlighted fields.');
      } else {
        setFormError(
          error instanceof ApiError ? error.message : 'Could not place your order. Please try again.',
        );
      }
      setSubmitting(false);
    }
  };

  if (serverCart === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (serverCart.items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Add some products before checking out."
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
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-8">
        <section aria-labelledby="shipping-heading" className="rounded-2xl border border-line bg-surface p-5">
          <h2 id="shipping-heading" className="text-base font-semibold text-ink">
            Shipping address
          </h2>

          {addresses.status === 'loading' ? (
            <Skeleton className="mt-4 h-24 w-full rounded-xl" />
          ) : addresses.status === 'error' ? (
            <div className="mt-4">
              <ErrorState
                title="Could not load your addresses"
                description={addresses.message}
                onRetry={() => setReloadKey((key) => key + 1)}
              />
            </div>
          ) : (
            <fieldset className="mt-4">
              <legend className="sr-only">Choose a shipping address</legend>
              {addresses.items.length > 0 ? (
                <ul className="space-y-2">
                  {addresses.items.map((address) => (
                    <li key={address._id}>
                      <label className="flex cursor-pointer gap-3 rounded-xl border border-line p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                        <input
                          type="radio"
                          name="shipping-address"
                          value={address._id}
                          checked={selection === address._id}
                          onChange={() => setSelection(address._id)}
                          className="mt-1 size-4 accent-accent"
                        />
                        <span>
                          <span className="font-medium text-ink">
                            {address.label ? `${address.label} — ` : ''}
                            {address.fullName}
                          </span>
                          <span className="mt-0.5 block text-muted">
                            {address.line1}
                            {address.line2 ? `, ${address.line2}` : ''}, {address.city}
                            {address.postalCode ? ` ${address.postalCode}` : ''}, {address.country}
                            <br />
                            {address.phone}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                  <li>
                    <label className="flex cursor-pointer gap-3 rounded-xl border border-line p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                      <input
                        type="radio"
                        name="shipping-address"
                        value="new"
                        checked={selection === 'new'}
                        onChange={() => setSelection('new')}
                        className="mt-1 size-4 accent-accent"
                      />
                      <span className="font-medium text-ink">Use a new address</span>
                    </label>
                  </li>
                </ul>
              ) : null}

              {selection === 'new' ? (
                <div className="mt-4">
                  <AddressForm
                    idPrefix="checkout"
                    values={addressValues}
                    errors={addressErrors}
                    disabled={submitting}
                    onChange={onAddressChange}
                  />
                  <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={saveAddress}
                      onChange={(event) => setSaveAddress(event.target.checked)}
                      className="size-4 accent-accent"
                    />
                    Save this address to my account
                  </label>
                </div>
              ) : null}
            </fieldset>
          )}
        </section>

        <section aria-labelledby="payment-heading" className="rounded-2xl border border-line bg-surface p-5">
          <h2 id="payment-heading" className="text-base font-semibold text-ink">
            Payment method
          </h2>
          <p className="mt-3 rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink">
            Cash on Delivery — pay with cash when your order arrives.
          </p>
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-20" aria-label="Order summary">
        <h2 className="text-base font-semibold text-ink">Order summary</h2>

        <ul className="mt-4 space-y-2 text-sm">
          {serverCart.items.map((item) => (
            <li key={item.variantId} className="flex justify-between gap-3">
              <span className="text-muted">
                {item.name ?? 'Unavailable item'}
                {item.size || item.color
                  ? ` (${[item.size, item.color].filter(Boolean).join(' / ')})`
                  : ''}{' '}
                × {item.quantity}
              </span>
              <span className="font-medium text-ink">
                <Price poisha={item.lineTotal ?? 0} />
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="font-medium text-ink">
              <Price poisha={serverCart.subtotal} />
            </dd>
          </div>
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
        </dl>

        <div className="mt-5 space-y-3">
          {formError ? (
            <Notice tone="error">{formError}</Notice>
          ) : null}
          {retryNote ? (
            <Notice tone="info">{retryNote}</Notice>
          ) : null}
          {conflict ? (
            <Notice tone="error">
              <p>{conflict}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => router.push('/cart')}
              >
                Back to cart
              </Button>
            </Notice>
          ) : null}

          <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={submitting}>
            Place order (Cash on Delivery)
          </Button>
          <p className="text-xs text-muted">
            By placing this order you agree to pay on delivery. Prices and stock are confirmed by
            the server.
          </p>
        </div>
      </aside>
    </form>
  );
}
