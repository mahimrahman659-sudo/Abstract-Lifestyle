import { CURRENCY } from '../../config/currency';

const formatter = new Intl.NumberFormat(CURRENCY.locale, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Converts integer poisha to a BDT display string, e.g. 123456 → ৳1,234.56 */
export const formatPoisha = (poisha: number): string =>
  `${CURRENCY.symbol}${formatter.format(poisha / CURRENCY.subunitPerUnit)}`;

/**
 * Exact decimal-string → integer poisha conversion (never goes through float).
 * "89.99" → 8999, "0.1" → 10, "1000" → 100000. Returns null for invalid input.
 */
export const parseTakaToPoisha = (value: string): number | null => {
  const trimmed = value.trim();
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return whole * CURRENCY.subunitPerUnit + Number(fraction);
};

/** Integer poisha → taka input string. 8999 → "89.99", 100000 → "1000.00" */
export const poishaToTakaInput = (poisha: number): string => {
  const whole = Math.trunc(poisha / CURRENCY.subunitPerUnit);
  const fraction = Math.abs(poisha % CURRENCY.subunitPerUnit);
  return `${whole}.${String(fraction).padStart(2, '0')}`;
};
