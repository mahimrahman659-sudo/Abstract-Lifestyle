/** Keeps SKUs to upper-case A–Z, 0–9 and single dashes (max 64 chars). */
export const sanitizeSku = (value: string, maxLength = 64): string => {
  const cleaned = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return cleaned;
};

/** SKU generated for a bulk size variant: `PREFIX-SIZE` (both sanitized). */
export const variantSku = (prefix: string, size: string): string => sanitizeSku(`${prefix}-${size}`);
