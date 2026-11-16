/** Canonical apparel size labels (upper-case); everything else keeps its casing. */
const APPAREL_SIZES = new Set(['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL']);

const collapseWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ');

/**
 * Normalizes a variant size. Blank values become `null` (an empty size string
 * would otherwise render as a blank size button), apparel tokens are
 * upper-cased ("m" → "M", "2xl" → "2XL") and any other value is kept as typed
 * with collapsed spacing ("500 ml" stays readable).
 */
export const normalizeSize = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const collapsed = collapseWhitespace(value);
  if (collapsed.length === 0) {
    return null;
  }
  const upper = collapsed.toUpperCase();
  return APPAREL_SIZES.has(upper) ? upper : collapsed;
};

/**
 * Normalizes a color name to Title Case so "white", "White" and "WHITE" are the
 * same variant combination instead of three near-duplicate color swatches.
 */
export const normalizeColor = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const collapsed = collapseWhitespace(value);
  if (collapsed.length === 0) {
    return null;
  }
  return collapsed
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};
