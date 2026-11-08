/** Products created within this window display the "New" badge. */
export const NEW_BADGE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Window length in milliseconds (14 days). */
export const NEW_BADGE_WINDOW_MS = NEW_BADGE_DAYS * DAY_MS;

/**
 * True when `createdAtIso` is at or after `cutoffMs` (a precomputed
 * `now - NEW_BADGE_WINDOW_MS`). Callers pass a cutoff — never the clock — so the
 * check is pure and can run during prerender and in the browser alike.
 */
export const isCreatedAfter = (createdAtIso: string, cutoffMs: number): boolean => {
  const created = Date.parse(createdAtIso);
  return !Number.isNaN(created) && created >= cutoffMs;
};
