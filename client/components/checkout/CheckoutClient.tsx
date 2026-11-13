'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AddressForm, type AddressFormErrors } from '@/components/checkout/AddressForm';
import { CheckoutSteps } from '@/components/checkout/CheckoutSteps';
import { useAuth } from '@/components/auth/AuthProvider';
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
import {
  clearCheckoutDraft,
  readCheckoutDraft,
  saveCheckoutDraft,
} from '@/lib/checkout/draft';

type AddressesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; items: Address[] };

const emptyAddress: AddressFormValues = {
  fullName: '',
  phone: '',
  line1: '',
  country: 'Bangladesh',
};

/** Field order used by the error summary and focus handling. */
const FIELD_ORDER: Array<keyof AddressFormValues> = ['fullName', 'phone', 'line1'];
const FIELD_LABELS: Partial<Record<keyof AddressFormValues, string>> = {
  fullName: 'Full name',
  phone: 'Phone number',
  line1: 'Address',
};

export function CheckoutClient() {
  const router = useRouter();
  const { user } = useAuth();
  const { serverCart, resetCart } = useCart();

  // One idempotency key per checkout attempt: retries of this same form submit
  // reuse it, so the server can never create a duplicate order.
  const checkoutIdRef = useRef<string>('');
  // Synchronous guard: a fast double-click cannot start two requests.
  const inFlightRef = useRef(false);

  const [addresses, setAddresses] = useState<AddressesState>({ status: 'loading' });
  const [selection, setSelection] = useState<string>('new');
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const [addressValues, setAddressValues] = useState<AddressFormValues>(emptyAddress);
  const [addressErrors, setAddressErrors] = useState<AddressFormErrors>({});
  const [saveAddress, setSaveAddress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<Array<{ field: keyof AddressFormValues; message: string }>>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Restore an in-session draft (name/phone/address only) after mount.
  useEffect(() => {
    const draft = readCheckoutDraft();
    if (!draft) {
      return;
    }
    void (async () => {
      await Promise.resolve();
      setAddressValues((previous) => ({
        ...previous,
        fullName: previous.fullName || draft.fullName,
        phone: previous.phone || draft.phone,
        line1: previous.line1 || draft.line1,
      }));
      setSaveAddress((previous) => previous || draft.saveAddress === true);
    })();
  }, []);

  // Keep the draft in sessionStorage while the shopper types.
  useEffect(() => {
    const hasInput = addressValues.fullName || addressValues.phone || addressValues.line1;
    if (!hasInput) {
      clearCheckoutDraft();
      return;
    }
    saveCheckoutDraft({
      fullName: addressValues.fullName,
      phone: addressValues.phone,
      line1: addressValues.line1,
      saveAddress,
    });
  }, [addressValues.fullName, addressValues.phone, addressValues.line1, saveAddress]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      setAddresses({ status: 'loading' });
      try {
        const { items } = await userApi.getAddresses();
        if (!cancelled) {
          setAddresses({ status: 'success', items });
          const preferred = items.find((item) => item.isDefault) ?? items[0];
          if (preferred && selection === 'new') {
            setSelection(preferred._id);
          }
          // Pre-fill the new-address form from the default saved address.
          if (preferred) {
            setAddressValues((previous) => ({
              ...previous,
              fullName: previous.fullName || preferred.fullName,
              phone: previous.phone || preferred.phone,
              line1: previous.line1 || preferred.line1,
            }));
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
    setErrorList((previous) => previous.filter((entry) => entry.field !== field));
  };

  /** Inline validation on blur: only the touched field is checked. */
  const onBlurField = (field: keyof AddressFormValues): void => {
    if (selection !== 'new') {
      return;
    }
    const all = validateAddress(addressValues);
    setAddressErrors((previous) => ({ ...previous, [field]: all[field] }));
  };

  /** Lists the submit errors and moves focus to the first invalid field. */
  const showErrors = (errors: AddressFormErrors): boolean => {
    const entries = FIELD_ORDER.filter((field) => errors[field]).map((field) => ({
      field,
      message: errors[field] as string,
    }));
    if (entries.length === 0) {
      setErrorList([]);
      return false;
    }
    setErrorList(entries);
    setFormError('Please fix the highlighted fields.');
    setAddressErrors(errors);
    requestAnimationFrame(() => {
      const target = document.getElementById(`checkout-${entries[0].field}`);
      if (target instanceof HTMLElement) {
        target.focus();
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
    return true;
  };

  // Pre-fill the name from the account, so checkout only needs phone + address.
  useEffect(() => {
    const accountName = user?.name;
    if (!accountName) {
      return;
    }
    void (async () => {
      await Promise.resolve();
      setAddressValues((previous) =>
        previous.fullName ? previous : { ...previous, fullName: accountName },
      );
    })();
  }, [user?.name]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inFlightRef.current) {
      return;
    }
    setFormError(null);
    setErrorList([]);
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
      if (showErrors(validation)) {
        return;
      }
      payload.shippingAddress = cleanAddressPayload(addressValues);
    } else {
      payload.shippingAddressId = selection;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const { order } = await orderApi.create(payload);

      if (selection === 'new' && saveAddress) {
        // Best-effort: the order is already placed if this fails.
        try {
          await userApi.createAddress({
            ...cleanAddressPayload(addressValues),
            // The first saved address becomes the default for next time.
            isDefault: addresses.status === 'success' && addresses.items.length === 0,
          });
        } catch {
          // Ignore — the address can be saved again from the account flow.
        }
      }

      // Clear the local cart immediately so the header badge shows 0 before the
      // confirmation page renders (the server already emptied the cart).
      resetCart();
      clearCheckoutDraft();
      // Keep `submitting` true: the button stays disabled until navigation.
      router.push(`/orders/${order.id}?placed=1`);
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
        showErrors(fieldErrorsFromApi(error));
      } else {
        setFormError(
          error instanceof ApiError ? error.message : 'Could not place your order. Please try again.',
        );
      }
      inFlightRef.current = false;
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

  const savedSelected =
    addresses.status === 'success'
      ? (addresses.items.find((item) => item._id === selection) ?? null)
      : null;

  const summaryCard = (
    <div className="rounded-2xl border border-line bg-surface p-5">
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
    </div>
  );

  const submitLabel = (
    <>
      Place order · <Price poisha={serverCart.total} />
    </>
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <CheckoutSteps current="Checkout" />

      {errorList.length > 0 ? (
        <div
          role="alert"
          tabIndex={-1}
          className="mb-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <p className="font-medium">Check these fields:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {errorList.map((entry) => (
              <li key={entry.field}>
                <a
                  href={`#checkout-${entry.field}`}
                  className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {FIELD_LABELS[entry.field] ?? entry.field}: {entry.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {retryNote || conflict || formError ? (
        <div className="mb-6 space-y-3">
          {retryNote ? <Notice tone="info">{retryNote}</Notice> : null}
          {conflict ? (
            <Notice tone="error">
              <p>{conflict}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 min-h-11"
                onClick={() => router.push('/cart')}
              >
                Back to cart
              </Button>
            </Notice>
          ) : null}
          {formError ? <Notice tone="error">{formError}</Notice> : null}
        </div>
      ) : null}

      {/* Mobile: collapsible summary right under the step indicator. */}
      <div className="mb-6 lg:hidden">
        <button
          type="button"
          aria-expanded={summaryOpen}
          aria-controls="mobile-order-summary"
          onClick={() => setSummaryOpen((open) => !open)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="text-sm font-semibold text-ink">
            Order summary <span className="font-normal text-muted">({serverCart.items.length})</span>
          </span>
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Price poisha={serverCart.total} />
            <span aria-hidden="true" className="text-xs text-muted">
              {summaryOpen ? '▴' : '▾'}
            </span>
          </span>
        </button>
        <div id="mobile-order-summary" className={summaryOpen ? 'mt-3' : 'hidden'}>
          {summaryCard}
        </div>
      </div>

      <div className="grid gap-8 pb-28 lg:grid-cols-[1fr_360px] lg:pb-0">
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
            <div className="mt-4">
              {/* Default saved address as a compact card; the picker stays closed
                  until "Change" is pressed. */}
              {savedSelected && !showAddressPicker && selection !== 'new' ? (
                <div className="rounded-xl border border-line bg-tile px-4 py-3">
                  <p className="text-sm font-medium text-ink">
                    {savedSelected.label ? `${savedSelected.label} — ` : ''}
                    {savedSelected.fullName}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {savedSelected.line1}
                    {savedSelected.line2 ? `, ${savedSelected.line2}` : ''}
                    {savedSelected.city ? `, ${savedSelected.city}` : ''}
                    {savedSelected.country ? `, ${savedSelected.country}` : ''}
                  </p>
                  <p className="text-sm text-muted">{savedSelected.phone}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3 min-h-11"
                    onClick={() => setShowAddressPicker(true)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <fieldset>
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
                              onChange={() => {
                                setSelection(address._id);
                                setShowAddressPicker(false);
                              }}
                              className="mt-1 size-4 accent-accent"
                            />
                            <span>
                              <span className="font-medium text-ink">
                                {address.label ? `${address.label} — ` : ''}
                                {address.fullName}
                              </span>
                              <span className="mt-0.5 block text-muted">
                                {address.line1}
                                {address.line2 ? `, ${address.line2}` : ''}
                                {address.city ? `, ${address.city}` : ''}
                                {address.postalCode ? ` ${address.postalCode}` : ''}
                                {address.country ? `, ${address.country}` : ''}
                                <br />
                                {address.phone}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 min-h-11"
                    onClick={() => setSelection('new')}
                  >
                    Use a new address
                  </Button>
                </fieldset>
              )}

              {selection === 'new' ? (
                <div className="mt-4">
                  <AddressForm
                    idPrefix="checkout"
                    values={addressValues}
                    errors={addressErrors}
                    disabled={submitting}
                    onChange={onAddressChange}
                    onBlurField={onBlurField}
                  />
                  <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={saveAddress}
                      onChange={(event) => setSaveAddress(event.target.checked)}
                      className="size-4 accent-accent"
                    />
                    Save this address for next time
                  </label>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section aria-labelledby="payment-heading" className="rounded-2xl border border-line bg-surface p-5">
          <h2 id="payment-heading" className="text-base font-semibold text-ink">
            Payment method
          </h2>
          {/* Selected and non-interactive: Cash on Delivery is the only method. */}
          <div
            aria-current="true"
            className="mt-3 flex items-start gap-3 rounded-xl border-2 border-brand bg-brand/5 px-4 py-3 text-sm text-ink"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-white"
            >
              ✓
            </span>
            <span>
              <span className="font-semibold">Cash on Delivery</span>
              <span className="mt-0.5 block text-muted">
                Pay with cash when your order arrives. No card needed.
              </span>
            </span>
          </div>
        </section>
      </div>

      <aside
        className="hidden h-fit space-y-4 lg:sticky lg:top-20 lg:block"
        aria-label="Order summary"
      >
        {summaryCard}
        <div className="space-y-3">
          <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={submitting}>
            {submitLabel}
          </Button>
          <p className="text-xs text-muted">
            By placing this order you agree to pay on delivery. Prices and stock are confirmed by
            the server.
          </p>
        </div>
      </aside>
      </div>

      {/* Mobile: sticky place-order bar. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <div className="mx-auto max-w-6xl">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={submitting}
            disabled={submitting}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
