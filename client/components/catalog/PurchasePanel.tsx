'use client';

import { useMemo, useState } from 'react';
import { useCart } from '@/components/cart/CartProvider';
import { SizeGuideDialog } from '@/components/catalog/SizeGuideDialog';
import { Button } from '@/components/ui/Button';
import { CartIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { ApiError } from '@/lib/api/client';
import { getSwatchColor, isLightSwatch } from '@/lib/catalog/color-map';
import type { PublicVariant } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

interface PurchasePanelProps {
  productName: string;
  basePrice: number;
  /** Product-level compare-at (used when the selected variant has no own sale). */
  compareAtPrice: number | null;
  discountPercent: number;
  variants: PublicVariant[];
  sizeGuideKey: 'clothing' | null;
  /** Short description shown under the price (full text lives in the tabs). */
  description?: string;
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
  compareAtPrice,
  discountPercent,
  variants,
  sizeGuideKey,
  description,
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

  // Server-computed sale values for the current selection — never calculated here.
  const displayPrice = selectedVariant ? selectedVariant.price : basePrice;
  const displayCompareAt = selectedVariant ? selectedVariant.compareAtPrice : compareAtPrice;
  const displayDiscount = selectedVariant ? selectedVariant.discountPercent : discountPercent;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-2xl font-bold tracking-tight text-ink">
            <Price poisha={displayPrice} />
          </span>
          {displayDiscount > 0 && displayCompareAt !== null ? (
            <>
              <s aria-label="Original price" className="text-sm text-muted line-through">
                <Price poisha={displayCompareAt} />
              </s>
              <span className="rounded-[4px] bg-brand px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                −{displayDiscount}%
              </span>
            </>
          ) : null}
        </p>
        {selectedVariant ? (
          <p
            className={cn(
              'mt-1 text-sm',
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
      </div>

      {description ? <p className="text-sm leading-relaxed text-muted">{description}</p> : null}

      <div className="border-t border-line pt-4">
        {colors.length > 0 ? (
          <fieldset>
            <legend className="mb-3 text-sm text-ink">
              Color: <span className="font-semibold">{selection.color ?? 'One color'}</span>
            </legend>
            <div className="flex flex-wrap gap-3">
              {colors.map((color) => {
                const available = isColorAvailable(color);
                const active = selection.color === color;
                const swatch = getSwatchColor(color);
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    aria-pressed={active}
                    disabled={!available}
                    onClick={() => selectColor(color)}
                    style={swatch ? { backgroundColor: swatch } : undefined}
                    className={cn(
                      'size-10 rounded-full border transition',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      active
                        ? 'border-ink ring-2 ring-ink ring-offset-2'
                        : swatch && isLightSwatch(swatch)
                          ? // White/cream/ivory/light-gray/beige need a visible edge on light surfaces.
                            'border-ink/30'
                          : 'border-line',
                      !swatch && 'bg-tile',
                      !available && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    {!swatch ? (
                      <span className="text-[9px] font-semibold uppercase text-muted">
                        {color.slice(0, 3)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-ink">
            Color: <span className="font-semibold">One color</span>
          </p>
        )}

        {sizes.length > 0 ? (
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm text-ink">
                Size: <span className="font-semibold">{selection.size ?? 'One size'}</span>
              </p>
              {sizeGuideKey === 'clothing' ? <SizeGuideDialog /> : null}
            </div>
            <fieldset>
              <legend className="sr-only">Size</legend>
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
                        'min-w-12 rounded-md border px-4 py-2 text-sm transition',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                        active
                          ? 'border-ink bg-ink text-white'
                          : 'border-line bg-surface text-ink hover:border-ink',
                        !available && 'cursor-not-allowed text-muted line-through opacity-50 hover:border-line',
                      )}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        ) : (
          <div className="mt-5 flex items-center justify-between gap-3">
            {/* Products sold in one size still say so — never "Size: —". */}
            <p className="text-sm text-ink">
              Size: <span className="font-semibold">One size</span>
            </p>
            {sizeGuideKey === 'clothing' ? <SizeGuideDialog /> : null}
          </div>
        )}

        <div className="mt-5 flex items-end gap-3">
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
        </div>

        <Button
          variant="primary"
          size="lg"
          radius="md"
          className="mt-5 w-full"
          onClick={() => void handleAddToCart()}
          disabled={outOfStock}
          loading={adding}
        >
          <CartIcon className="size-5" />
          {outOfStock ? 'Out of stock' : 'Add to cart'}
        </Button>

        {notice ? (
          <div className="mt-4">
            <Notice tone={notice.tone}>{notice.message}</Notice>
          </div>
        ) : null}
      </div>
    </div>
  );
}