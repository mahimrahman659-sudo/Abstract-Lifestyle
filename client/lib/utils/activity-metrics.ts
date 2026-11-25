import type { ActivityEventDto } from '../types';

/**
 * Pure display helpers for the Customer Activity Center (Phase 2 corrections).
 *
 * M-1: tracking-dependent metrics must never render a misleading numeric
 * zero while collection is disabled — they render an explicit "—" instead.
 * Real zeros remain visible whenever collection is actually running.
 */

/** Em-dash placeholder for a metric that cannot be measured right now. */
export const METRIC_UNAVAILABLE = '—';

/**
 * Stat-card value for a tracking-dependent metric.
 * - tracking on  → the real count, including a genuine `0`;
 * - tracking off → unavailable ("—"), never a factual-looking zero.
 */
export const displayLiveMetric = (trackingEnabled: boolean, value: number): string =>
  trackingEnabled ? String(value) : METRIC_UNAVAILABLE;

export type SessionListMode = 'list' | 'empty' | 'disabled';

/**
 * How the live session list should render:
 * - `disabled` — tracking off: current session state is not measurable;
 * - `empty`    — tracking on, nothing happened in the window (real zero);
 * - `list`     — tracking on with sessions to show.
 */
export const sessionListMode = (
  trackingEnabled: boolean,
  sessionCount: number,
): SessionListMode => {
  if (!trackingEnabled) return 'disabled';
  return sessionCount > 0 ? 'list' : 'empty';
};

export interface CustomerEventLink {
  href: string;
  label: string;
}

/** Event types whose acting identity is a CUSTOMER (not an admin). */
const CUSTOMER_ACTOR_TYPES: ReadonlySet<ActivityEventDto['type']> = new Set([
  'page.view',
  'product.view',
  'product.impression',
  'search.performed',
  'filter.applied',
  'sort.changed',
  'cart.checkout_clicked',
  'checkout.viewed',
  'cart.add',
  'cart.update',
  'cart.remove',
  'cart.clear',
  'cart.merge',
  'checkout.started',
  'order.purchased',
  'order.cancelled',
  'payment.claim_submitted',
  'auth.login',
  'auth.register',
  'auth.google_login',
  'auth.logout',
]);

/**
 * L-1: correct customer link for a feed row.
 * - `admin.customer_viewed` links the VIEWED customer (`customerId`),
 * - customer-actor events link the acting customer (`userId`),
 * - admin-actor events (admin.*, reviewed/refunded payments, …) return null
 *   so an admin id is never mislabeled as "customer".
 */
export const customerEventLink = (
  event: Pick<ActivityEventDto, 'type' | 'userId' | 'customerId'>,
): CustomerEventLink | null => {
  if (event.type === 'admin.customer_viewed' && event.customerId) {
    return { href: `/admin/customers/${event.customerId}`, label: 'viewed customer' };
  }
  if (event.userId && CUSTOMER_ACTOR_TYPES.has(event.type)) {
    return { href: `/admin/customers/${event.userId}`, label: 'customer' };
  }
  return null;
};
