/**
 * Single source of truth for currency display (PROJECT_CONTEXT §10).
 * All money values in the app are integer poisha (100 poisha = 1 BDT).
 */
export const CURRENCY = {
  code: 'BDT',
  symbol: '৳',
  subunitPerUnit: 100,
  locale: 'en-US',
} as const;

export type Currency = typeof CURRENCY;
