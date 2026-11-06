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

const variantLabel = (size: string | null, color: string | null): string | null => {
  const parts = [size, color].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : null;
};

function LineShell({
  image,
  name,
  nameHref,
  meta,
  quantity,
  unitPrice,
  lineTotal,
  busy,
  onQuantityChange,
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
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:flex-row">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-paper">
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

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted">
            Unit price: <Price poisha={unitPrice} />
          </p>
          <label className="flex items-center gap-2 text-xs text-muted">
            Quantity
            <input
              type="number"
              min={1}
              max={20}
              value={quantity}
              disabled={busy}
              onChange={(event) => onQuantityChange(Number(event.target.value))}
              className="h-9 w-16 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
            />
          </label>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
        </div>

        {children}
      </div>
    </li>
  );
}

export function ServerCartLine({ item, actions }: { item: CartItemView; actions: LineActions }) {
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
      onQuantityChange={(quantity) => actions.onQuantityChange(item.variantId, quantity)}
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

export function GuestCartLine({ line, actions }: { line: GuestCartLineView; actions: LineActions }) {
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
      onQuantityChange={(quantity) => actions.onQuantityChange(line.variantId, quantity)}
      onRemove={() => actions.onRemove(line.variantId)}
    />
  );
}
