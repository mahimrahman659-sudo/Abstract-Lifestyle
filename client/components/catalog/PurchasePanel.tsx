'use client';

import { useMemo, useState } from 'react';
import { useCart } from '@/components/cart/CartProvider';
import { SizeGuideDialog } from '@/components/catalog/SizeGuideDialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { ApiError } from '@/lib/api/client';
import type { PublicVariant } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

interface PurchasePanelProps {
  productName: string;
  basePrice: number;
  variants: PublicVariant[];
  sizeGuideKey: 'clothing' | null;
}

interface PanelNotice {
  tone: NoticeTone;
  message: string;
}

const uniqueOptions = (values: Array<string | null>): string[] =>
  Array.from(new Set(values.filter((value): value is string => value !== null))).sort();

const stockLabel = (variant: PublicVariant): string => {
  if (variant.stock === 0) {
    return 'Out of stock';
  }
  return variant.lowStock ? `Only ${variant.stock} left` : 'In stock';
};

const pickInitialVariant = (variants: PublicVariant[]): PublicVariant | null =>
  variants.find((variant) => variant.stock > 0) ?? variants[0] ?? null;

export function PurchasePanel({
  productName,
  basePrice,
  variants,
  sizeGuideKey,
}: PurchasePanelProps) {
  const { addItem, serverCart } = useCart();
  const sizes = useMemo(() => uniqueOptions(variants.map((variant) => variant.size)), [variants]);
  const colors = useMemo(() => uniqueOptions(variants.map((variant) => variant.color)), [variants]);

  const [selection, setSelection] = useState(() => {
    const initial = pickInitialVariant(variants);
    return { size: initial?.size ?? null, color: initial?.color ?? null };
  });
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<PanelNotice | null>(null);

  const selectedVariant =
    variants.find(
      (variant) => variant.size === selection.size && variant.color === selection.color,
    ) ?? null;

  const isSizeAvailable = (size: string): boolean =>
    variants.some((variant) => variant.size === size && variant.color === selection.color);

  const isColorAvailable = (color: string): boolean =>
    variants.some((variant) => variant.color === color && variant.size === selection.size);

  const selectSize = (size: string) => {
    const match =
      variants.find((variant) => variant.size === size && variant.color === selection.color) ??
      variants.find((variant) => variant.size === size);
    setSelection({ size, color: match?.color ?? null });
    setNotice(null);
  };

  const selectColor = (color: string) => {
    const match =
      variants.find((variant) => variant.color === color && variant.size === selection.size) ??
      variants.find((variant) => variant.color === color);
    setSelection({ size: match?.size ?? null, color });
    setNotice(null);
  };

  const handleAddToCart = async () => {
    if (!selectedVariant) {
      return;
    }
    setAdding(true);
    setNotice(null);

    try {
      const requested = Number.isFinite(quantity)
        ? Math.min(Math.max(1, Math.trunc(quantity)), 20)
        : 1;
      const previousQuantity =
        serverCart?.items.find((item) => item.variantId === selectedVariant.id)?.quantity ?? 0;
      const cart = await addItem(selectedVariant.id, requested);

      if (cart) {
        const line = cart.items.find((item) => item.variantId === selectedVariant.id);
        const finalQuantity = line?.quantity ?? 0;
        const expected = previousQuantity + requested;
        if (finalQuantity < expected) {
          setNotice({
            tone: 'info',
            message: `Only ${finalQuantity} available — quantity set to ${finalQuantity}.`,
          });
        } else {
          setNotice({
            tone: 'success',
            message: `Added to cart — ${finalQuantity} × ${productName} in your cart.`,
          });
        }
      } else {
        setNotice({
          tone: 'success',
          message: 'Added to cart. Guest carts merge automatically when you sign in.',
        });
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof ApiError ? error.message : 'Could not add this item to your cart.',
      });
    } finally {
      setAdding(false);
    }
  };

  const outOfStock = !selectedVariant || selectedVariant.stock === 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xl font-semibold text-ink">
        <Price poisha={selectedVariant ? selectedVariant.price : basePrice} />
      </p>

      {selectedVariant ? (
        <p
          className={cn(
            'text-sm',
            selectedVariant.stock === 0
              ? 'text-danger'
              : selectedVariant.lowStock
                ? 'text-warning'
                : 'text-success',
          )}
          aria-live="polite"
        >
          {stockLabel(selectedVariant)}
        </p>
      ) : null}

      {sizes.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Size</legend>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const available = isSizeAvailable(size);
              const active = selection.size === size;
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={active}
                  disabled={!available}
                  onClick={() => selectSize(size)}
                  className={cn(
                    'min-w-12 rounded-full border px-4 py-2 text-sm',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    active ? 'border-accent bg-accent text-white' : 'border-line text-ink',
                    !available && 'cursor-not-allowed text-muted line-through opacity-50',
                  )}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {colors.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Color</legend>
          <div className="flex flex-wrap gap-2">
            {colors.map((color) => {
              const available = isColorAvailable(color);
              const active = selection.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  aria-pressed={active}
                  disabled={!available}
                  onClick={() => selectColor(color)}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    active ? 'border-accent bg-accent text-white' : 'border-line text-ink',
                    !available && 'cursor-not-allowed text-muted line-through opacity-50',
                  )}
                >
                  {color}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="flex items-end gap-3">
        <div className="w-28">
          <Input
            label="Quantity"
            type="number"
            min={1}
            max={20}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        </div>
        {sizeGuideKey === 'clothing' ? <SizeGuideDialog /> : null}
      </div>

      <Button
        size="lg"
        onClick={() => void handleAddToCart()}
        disabled={outOfStock}
        loading={adding}
      >
        {outOfStock ? 'Out of stock' : 'Add to cart'}
      </Button>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}
    </div>
  );
}