import { CURRENCY } from '../../config/currency';

const formatter = new Intl.NumberFormat(CURRENCY.locale, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Converts integer poisha to a BDT display string, e.g. 123456 → ৳1,234.56 */
export const formatPoisha = (poisha: number): string =>
  `${CURRENCY.symbol}${formatter.format(poisha / CURRENCY.subunitPerUnit)}`;
