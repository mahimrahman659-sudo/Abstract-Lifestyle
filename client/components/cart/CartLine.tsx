'use client';

import Link from 'next/link';
import { ProductImage } from '@/components/catalog/ProductCard';
import { Button } from '@/components/ui/Button';
import { Price } from '@/components/ui/Price';
import type { CartItemView, GuestCartLineView } from '@/lib/types';

interface LineActions {
  onQuantityChange: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
  onFixQuantity: (variantId: string) => void;
  busy: boolean;
}

/** Per-line async feedback (e.g. the server capped the quantity). */
export interface LineNotice {
  tone: 'info' | 'error';
  message: string;
}

const variantLabel = (size: string | null, color: string | null): string | null => {
  const parts = [size, color].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : null;
};

const stepperButtonClass =
  'flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-base text-ink hover:bg-tile disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Quantity stepper: −/+ are 44×44px targets; the value is server-confirmed. */
function QuantityStepper({
  quantity,
  busy,
  onChange,
}: {
  quantity: number;
  busy: boolean;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={busy || quantity <= 1}
        onClick={() => onChange(quantity - 1)}
        className={stepperButtonClass}
      >
        −
      </button>
      <span
        aria-live="polite"
        className="flex h-11 w-12 items-center justify-center rounded-lg border border-line bg-tile text-sm font-semibold text-ink"
      >
        {quantity}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={busy || quantity >= 20}
        onClick={() => onChange(quantity + 1)}
        className={stepperButtonClass}
      >
        +
      </button>
    </div>
  );
}

function LineShell({
  image,
  name,
  nameHref,
  meta,
  quantity,
  unitPrice,
  lineTotal,
  busy,
  notice,
  onChangeQuantity,
  onRemove,
  children,
}: {
  image: string | null;
  name: string;
  nameHref?: string;
  meta: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  busy: boolean;
  notice?: LineNotice | null;
  onChangeQuantity: (quantity: number) => void;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li
      aria-busy={busy || undefined}
      className={`flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 transition-opacity sm:flex-row ${
        busy ? 'pointer-events-none opacity-60' : ''
      }`}
    >
      <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-tile">
        <ProductImage src={image} name={name} />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div>
            {nameHref ? (
              <Link
                href={nameHref}
                className="text-sm font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {name}
              </Link>
            ) : (
              <p className="text-sm font-medium text-ink">{name}</p>
            )}
            {meta ? <p className="mt-0.5 text-xs text-muted">{meta}</p> : null}
          </div>
          <p className="text-sm font-semibold text-ink">
            <Price poisha={lineTotal} />
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-xs text-muted">
            Unit price: <Price poisha={unitPrice} />
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted" aria-hidden="true">
              Qty
            </span>
            <QuantityStepper quantity={quantity} busy={busy} onChange={onChangeQuantity} />
          </div>
          <Button variant="ghost" size="md" disabled={busy} onClick={onRemove} className="min-h-11">
            Remove
          </Button>
        </div>

        {notice ? (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
            className={`text-xs ${notice.tone === 'error' ? 'text-danger' : 'text-muted'}`}
          >
            {notice.message}
          </p>
        ) : null}

        {children}
      </div>
    </li>
  );
}

export function ServerCartLine({
  item,
  actions,
  notice,
}: {
  item: CartItemView;
  actions: LineActions;
  notice?: LineNotice | null;
}) {
  const meta = variantLabel(item.size, item.color);
  const flagged = item.unavailable || item.outOfStock || item.insufficientStock;

  return (
    <LineShell
      image={item.image}
      name={item.name ?? 'Unavailable item'}
      meta={meta}
      quantity={item.quantity}
      unitPrice={item.unitPrice ?? 0}
      lineTotal={item.lineTotal ?? 0}
      busy={actions.busy}
      notice={notice}
      onChangeQuantity={(quantity) => actions.onQuantityChange(item.variantId, quantity)}
      onRemove={() => actions.onRemove(item.variantId)}
    >
      {flagged ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span role="alert">
            {item.unavailable
              ? 'This item is no longer available.'
              : item.outOfStock
                ? 'This item is out of stock.'
                : 'Not enough stock for this quantity.'}
          </span>
          {item.insufficientStock && !item.outOfStock && !item.unavailable ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onFixQuantity(item.variantId)}
            >
              Reduce to available stock
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onRemove(item.variantId)}
            >
              Remove item
            </Button>
          )}
        </div>
      ) : null}
    </LineShell>
  );
}

export function GuestCartLine({
  line,
  actions,
  notice,
}: {
  line: GuestCartLineView;
  actions: LineActions;
  notice?: LineNotice | null;
}) {
  return (
    <LineShell
      image={line.image}
      name={line.name}
      nameHref={`/products/${line.slug}`}
      meta={variantLabel(line.size, line.color)}
      quantity={line.quantity}
      unitPrice={line.unitPrice}
      lineTotal={line.lineTotal}
      busy={actions.busy}
      notice={notice}
      onChangeQuantity={(quantity) => actions.onQuantityChange(line.variantId, quantity)}
      onRemove={() => actions.onRemove(line.variantId)}
    />
  );
}
