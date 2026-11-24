import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * Customer Activity Center — event store (Phase 1A foundation).
 *
 * Design rules (CUSTOMER_ACTIVITY_MONITORING_PLAN.md §5.1/§5.5):
 * - Closed taxonomy: no event type outside these lists is ever persisted.
 * - `client` types are the only ones accepted from POST /api/events; the
 *   `server` types exist for Phase 1B emitters and are rejected on ingest.
 * - Never stores raw IP addresses, user agents, passwords, tokens, OTPs,
 *   payment transaction references, e-mail, phone or addresses.
 * - `userId` is written only from the server-verified auth cookie, never from
 *   a client payload.
 *
 * Indexes below are DESIGN ONLY. They materialize only where mongoose
 * autoIndex is enabled (local development) or where tests call
 * `syncIndexes()` against a disposable *_test database. Production index
 * creation is a separate, owner-approved Phase 4 rollout; the API must run
 * correctly without them (in-batch deduplication degrades to app level).
 */
export const ACTIVITY_EVENT_TYPES = [
  // --- client-accepted (Phase 1A ingest) ---
  'page.view',
  'product.view',
  'product.impression',
  'search.performed',
  'filter.applied',
  'sort.changed',
  'cart.checkout_clicked',
  'checkout.viewed',
  // --- server-only (Phase 1B emitters; rejected from client input) ---
  'auth.login',
  'auth.register',
  'auth.google_login',
  'auth.logout',
  'cart.add',
  'cart.update',
  'cart.remove',
  'cart.clear',
  'cart.merge',
  'checkout.started',
  'order.purchased',
  'order.cancelled',
  'payment.claim_submitted',
  'payment.claim_reviewed',
  'payment.refunded',
  'admin.order_status_changed',
  'admin.product_created',
  'admin.product_updated',
  'admin.product_deleted',
  'admin.variant_created',
  'admin.variant_updated',
  'admin.variant_deleted',
  'admin.variant_restored',
  'admin.customer_viewed',
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/** The only types permitted in client-originated events. */
export const CLIENT_ACTIVITY_EVENT_TYPES = [
  'page.view',
  'product.view',
  'product.impression',
  'search.performed',
  'filter.applied',
  'sort.changed',
  'cart.checkout_clicked',
  'checkout.viewed',
] as const;

export type ClientActivityEventType = (typeof CLIENT_ACTIVITY_EVENT_TYPES)[number];

export type ActivityEventSource = 'client' | 'server';
export type ActivityDevice = 'mobile' | 'desktop' | 'tablet';

/** Retention: 90 days (plan decision D2 recommendation). Applied via TTL index. */
export const ACTIVITY_EVENT_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Pinned collection name (mongoose would pluralize `ActivityEvent` to
 * `activityevents`). Shared with the index-readiness gate.
 */
export const ACTIVITY_COLLECTION_NAME = 'activity_events';

export interface ActivityEvent {
  /**
   * Dedup key: UUID **v4** for client events and one-off server facts;
   * deterministic UUID **v5** for retryable business facts (order placed,
   * cancelled, claim reviewed, …) so retries collapse to one document.
   */
  eventId: string;
  type: ActivityEventType;
  source: ActivityEventSource;
  /** Event time; client values are clamped to [now-24h, now+5min] before persist. */
  ts: Date;
  /** Server-resolved from the verified auth cookie only; never client-supplied. */
  userId?: Types.ObjectId;
  /** Browser-scoped anonymous id (format-checked; only sent when permitted). */
  anonymousId?: string;
  /** Tab-session id (format-checked; only sent when permitted). */
  sessionId?: string;
  /** Normalized route path — query string and fragment are stripped. */
  path?: string;
  productId?: Types.ObjectId;
  variantId?: Types.ObjectId;
  orderId?: Types.ObjectId;
  /** Customer viewed by an admin (`admin.customer_viewed` target). */
  customerId?: Types.ObjectId;
  /** Structured search term (≤100 chars) — never embedded in `path`. */
  query?: string;
  quantity?: number;
  /** Integer poisha (server events only; e.g. order total). */
  value?: number;
  referrerDomain?: string;
  device?: ActivityDevice;
  /** Server-only: outcome of `payment.claim_reviewed`. */
  decision?: 'paid' | 'rejected';
  /** Server-only: status transition of `admin.order_status_changed`. */
  fromStatus?: OrderStatusLike;
  toStatus?: OrderStatusLike;
  createdAt: Date;
}

/** Order statuses referenced by admin status-change events. */
export type OrderStatusLike =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type ActivityEventDocument = HydratedDocument<ActivityEvent>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[345][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,36}$/;

const activityEventSchema = new Schema<ActivityEvent>(
  {
    eventId: {
      type: String,
      required: true,
      match: [UUID_PATTERN, 'eventId must be a UUID (v3/v4/v5)'],
    },
    type: { type: String, enum: [...ACTIVITY_EVENT_TYPES], required: true },
    source: { type: String, enum: ['client', 'server'], required: true },
    ts: { type: Date, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    anonymousId: { type: String, match: [SESSION_ID_PATTERN, 'invalid anonymousId'] },
    sessionId: { type: String, match: [SESSION_ID_PATTERN, 'invalid sessionId'] },
    path: { type: String, maxlength: 200 },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: Schema.Types.ObjectId, ref: 'Variant' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    customerId: { type: Schema.Types.ObjectId, ref: 'User' },
    query: { type: String, maxlength: 100 },
    quantity: { type: Number, min: 1, max: 999 },
    value: { type: Number, min: 0 },
    referrerDomain: { type: String, maxlength: 100 },
    device: { type: String, enum: ['mobile', 'desktop', 'tablet'] },
    decision: { type: String, enum: ['paid', 'rejected'] },
    fromStatus: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    },
    toStatus: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    },
  },
  {
    // Events are immutable facts: createdAt only, no updatedAt churn.
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  },
);

// --- Index designs (see header comment: production rollout is Phase 4) ---

/** Idempotent ingestion: duplicate submissions collapse to one document. */
activityEventSchema.index(
  { eventId: 1 },
  { unique: true, name: 'activity_eventId_unique' },
);

/** Retention (TTL) + live-window scans. */
activityEventSchema.index(
  { ts: 1 },
  { expireAfterSeconds: ACTIVITY_EVENT_TTL_SECONDS, name: 'activity_ts_ttl' },
);

/** Feed filters and type aggregations. */
activityEventSchema.index(
  { type: 1, ts: -1 },
  { name: 'activity_type_ts' },
);

/** Customer timeline (sparse: anonymous events carry no userId). */
activityEventSchema.index(
  { userId: 1, ts: -1 },
  { sparse: true, name: 'activity_userId_ts' },
);

/** Live-visitor distinct counts. */
activityEventSchema.index(
  { sessionId: 1, ts: -1 },
  { name: 'activity_sessionId_ts' },
);

/** Product analytics. */
activityEventSchema.index(
  { productId: 1, ts: -1 },
  { name: 'activity_productId_ts' },
);

// Third argument pins the collection name: mongoose would otherwise
// pluralize `ActivityEvent` to `activityevents` instead of the planned
// `activity_events`.
export const ActivityEventModel = model<ActivityEvent>(
  'ActivityEvent',
  activityEventSchema,
  ACTIVITY_COLLECTION_NAME,
);
