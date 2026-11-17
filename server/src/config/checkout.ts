/**
 * Checkout claim lease. A cart marked `checkoutInProgress` older than this is
 * treated as a crashed checkout and may be re-claimed / mutated again.
 *
 * Shared by the cart service (rejects mutations during an active checkout) and
 * the order service (claims / releases the cart) so both sides always agree.
 */
export const CHECKOUT_CLAIM_STALE_MS = 60_000;

/** Maximum attempts for an optimistic cart mutation before giving up. */
export const CART_MUTATION_ATTEMPTS = 3;

export const CHECKOUT_IN_PROGRESS_MESSAGE =
  'Checkout is in progress for this cart. Finish or cancel it, then try again.';

/**
 * Compare-and-swap filter for the cart `version`.
 *
 * Carts created before the version field existed have no stored value; Mongoose
 * hydrates the default `0`, but the document itself has no such field until its
 * first write. Treating "missing" as version 0 keeps those carts mutable
 * instead of failing every compare-and-swap.
 */
export const cartVersionFilter = (version: number): Record<string, unknown> =>
  version === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version };
