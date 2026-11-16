/**
 * Canonical apparel size order. The storefront sorts sizes with this instead of
 * alphabetically ("L, M, S, XL" reads as noise to a shopper), with any other
 * value (38, 500 ml, …) sorted naturally after the apparel sizes.
 */
export const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'] as const;

/** Size chips offered in the admin (apparel sizes cover the overwhelming case). */
export const SIZE_CHIPS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

const rankOf = (size: string): number => {
  const index = SIZE_ORDER.indexOf(size.trim().toUpperCase() as (typeof SIZE_ORDER)[number]);
  return index === -1 ? SIZE_ORDER.length : index;
};

export const sortSizes = (sizes: readonly string[]): string[] =>
  [...sizes].sort((a, b) => {
    const rankA = rankOf(a);
    const rankB = rankOf(b);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
