/**
 * Sale-pricing helpers (single source of truth for the compare-at rules).
 *
 * Rule (client decision): a variant WITH its own price override uses only its
 * own compareAtPrice (none = no sale) — it never falls back to the product
 * value, which belongs to the product's base price. A variant WITHOUT its own
 * price uses the product's compareAtPrice.
 */

export const COMPARE_AT_RULE_MESSAGE = 'Compare-at price must be greater than the price.';

export const PRICE_RULE_MESSAGE =
  'Price must be lower than the compare-at price. Clear or raise the compare-at price first.';

/** Selling price for a variant, falling back to the product base price. */
export const effectivePrice = (
  variantPrice: number | null | undefined,
  basePrice: number,
): number => variantPrice ?? basePrice;

/** Compare-at price that applies to a variant (see rule above). */
export const resolveCompareAtPrice = (
  variantPrice: number | null | undefined,
  variantCompareAt: number | null | undefined,
  productCompareAt: number | null | undefined,
): number | null =>
  variantPrice !== null && variantPrice !== undefined
    ? (variantCompareAt ?? null)
    : (productCompareAt ?? null);

/**
 * Discount percentage, rounded down. Always 0 unless the compare-at price is
 * strictly greater than the selling price, so stale data can never show a
 * fake discount.
 */
export const discountPercent = (
  price: number,
  compareAtPrice: number | null | undefined,
): number => {
  if (compareAtPrice === null || compareAtPrice === undefined) {
    return 0;
  }
  if (compareAtPrice <= price || compareAtPrice <= 0) {
    return 0;
  }
  return Math.floor(((compareAtPrice - price) * 100) / compareAtPrice);
};
