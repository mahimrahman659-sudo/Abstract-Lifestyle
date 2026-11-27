'use client';

import { CopyButton } from '@/components/ui/CopyButton';
import { Notice } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import type { PaymentMethod, PublicPaymentMethod } from '@/lib/types';

type MethodsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; items: PublicPaymentMethod[] };

export function PaymentMethodSelector({
  state,
  selected,
  total,
  disabled,
  onSelect,
}: {
  state: MethodsState;
  selected: PaymentMethod;
  total: number;
  disabled?: boolean;
  onSelect: (method: PaymentMethod) => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="mt-4 space-y-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  const items: PublicPaymentMethod[] =
    state.status === 'success'
      ? state.items
      : [
          {
            method: 'cod',
            provider: 'cod',
            label: 'Cash on Delivery',
            enabled: true,
            receivingNumber: null,
            instructions: ['Pay in cash to the delivery person when your order arrives.'],
            requiresProof: false,
          },
        ];

  const selectedMethod = items.find((item) => item.method === selected) ?? items[0];

  return (
    <div className="mt-4 space-y-3">
      {state.status === 'error' ? (
        <Notice tone="info">
          Online payment options could not be loaded. Cash on Delivery is still available.
        </Notice>
      ) : null}

      <fieldset disabled={disabled}>
        <legend className="sr-only">Choose a payment method</legend>
        <ul className="space-y-2">
          {items.map((item) => {
            const isSelected = selectedMethod?.method === item.method;
            return (
              <li key={item.method}>
                <label
                  className={[
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                    isSelected ? 'border-2 border-brand bg-brand/5' : 'border-line bg-surface',
                    item.enabled ? '' : 'cursor-not-allowed opacity-60',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={item.method}
                    checked={isSelected}
                    disabled={!item.enabled}
                    onChange={() => onSelect(item.method)}
                    className="mt-1 size-4 accent-accent"
                  />
                  <span className="flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{item.label}</span>
                      {!item.enabled ? (
                        <span className="text-xs font-medium text-muted">Not available</span>
                      ) : item.method === 'cod' ? (
                        <span className="text-xs text-muted">Pay on delivery</span>
                      ) : (
                        <span className="text-xs text-muted">Manual verification</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-muted">
                      {item.method === 'cod'
                        ? 'Pay with cash when your order arrives. No card needed.'
                        : item.enabled
                          ? 'Transfer the exact total, then submit the sender number and transaction ID.'
                          : 'This method is not available right now.'}
                    </span>
                  </span>
                </label>

                {isSelected && item.enabled && item.requiresProof ? (
                  <div className="ml-7 mt-2 rounded-xl border border-line bg-tile p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      Send exactly
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-ink">
                      <Price poisha={total} />
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted">Receiving number</span>
                      <span className="font-mono text-base font-semibold tracking-wide text-ink">
                        {item.receivingNumber}
                      </span>
                      {item.receivingNumber ? (
                        <CopyButton
                          value={item.receivingNumber}
                          label="Copy number"
                          announcement={`${item.label} receiving number copied`}
                        />
                      ) : null}
                    </div>
                    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs text-muted">
                      {item.instructions.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-ink">
                      After placing the order, submit the sender number and transaction ID on the
                      order page. We will verify the payment before dispatch.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}
