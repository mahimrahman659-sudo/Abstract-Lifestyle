import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { CHECKOUT_CLAIM_STALE_MS } from '../config/checkout.js';
import { AppError } from '../middleware/error-handler.js';
import { ActivityEventModel, type ActivityEvent } from '../models/activity-event.model.js';
import { CartModel } from '../models/cart.model.js';
import { OrderModel } from '../models/order.model.js';
import { UserModel } from '../models/user.model.js';
import type {
  AdminActivityRecentQuery,
  AdminActivityTimelineQuery,
} from '../schemas/admin.schema.js';

/**
 * Admin read side of the Customer Activity Center (Phase 2).
 *
 * Read-only, admin-authorized (routes inherit requireAuth + requireRole),
 * time-boxed with maxTimeMS so a slow query degrades to a partial answer
 * (`stale: true`) instead of blocking the dashboard. Event-derived numbers
 * are naturally empty while ACTIVITY_EVENTS_ENABLED=false; carts/checkout
 * counts are live operational data, not tracking.
 */

/** Query time budget; over budget ⇒ partial result + stale flag (plan §8). */
const QUERY_TIME_MS = 2000;
const LIVE_WINDOW_MS = 5 * 60 * 1000;
const LIVE_SESSION_LIMIT = 50;
const LIVE_SCAN_LIMIT = 500;

export interface ActivityEventDto {
  id: string;
  type: string;
  source: 'client' | 'server';
  ts: Date;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
  path?: string;
  productId?: string;
  variantId?: string;
  orderId?: string;
  customerId?: string;
  query?: string;
  quantity?: number;
  value?: number;
  decision?: string;
  fromStatus?: string;
  toStatus?: string;
}

export const toActivityDto = (
  doc: ActivityEvent & { _id: Types.ObjectId },
): ActivityEventDto => ({
  id: doc._id.toString(),
  type: doc.type,
  source: doc.source,
  ts: doc.ts,
  ...(doc.userId ? { userId: doc.userId.toString() } : {}),
  ...(doc.anonymousId ? { anonymousId: doc.anonymousId } : {}),
  ...(doc.sessionId ? { sessionId: doc.sessionId } : {}),
  ...(doc.path ? { path: doc.path } : {}),
  ...(doc.productId ? { productId: doc.productId.toString() } : {}),
  ...(doc.variantId ? { variantId: doc.variantId.toString() } : {}),
  ...(doc.orderId ? { orderId: doc.orderId.toString() } : {}),
  ...(doc.customerId ? { customerId: doc.customerId.toString() } : {}),
  ...(doc.query ? { query: doc.query } : {}),
  ...(doc.quantity !== undefined ? { quantity: doc.quantity } : {}),
  ...(doc.value !== undefined ? { value: doc.value } : {}),
  ...(doc.decision ? { decision: doc.decision } : {}),
  ...(doc.fromStatus ? { fromStatus: doc.fromStatus } : {}),
  ...(doc.toStatus ? { toStatus: doc.toStatus } : {}),
});

export interface LiveSessionDto {
  /** `sessionId` or `user:<id>` or `anon` — display/stable grouping key. */
  identity: string;
  userId?: string;
  path?: string;
  lastTs: Date;
  events: number;
}

export interface LiveActivityDto {
  trackingEnabled: boolean;
  visitors5m: number;
  cartsWithItems: number;
  openCheckouts: number;
  sessions: LiveSessionDto[];
  generatedAt: Date;
  /** True when a query exceeded its time budget (partial data). */
  stale: boolean;
}

const isMaxTimeError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: unknown }).code === 50 ||
    (error as { codeName?: unknown }).codeName === 'MaxTimeMSExpired');

interface EventScanRow {
  _id: Types.ObjectId;
  sessionId?: string;
  userId?: Types.ObjectId;
  path?: string;
  ts: Date;
}

export const getLiveActivity = async (): Promise<LiveActivityDto> => {
  const now = Date.now();
  const since = new Date(now - LIVE_WINDOW_MS);
  const staleCutoff = new Date(now - CHECKOUT_CLAIM_STALE_MS);
  let stale = false;

  // Event scan (time-boxed): recent events grouped into sessions.
  let rows: EventScanRow[] = [];
  try {
    rows = (await ActivityEventModel.find({ ts: { $gt: since } })
      .select({ sessionId: 1, userId: 1, path: 1, ts: 1 })
      .sort({ ts: -1 })
      .limit(LIVE_SCAN_LIMIT)
      .maxTimeMS(QUERY_TIME_MS)
      .lean()
      .exec()) as unknown as EventScanRow[];
  } catch (error) {
    if (!isMaxTimeError(error)) {
      throw error;
    }
    stale = true;
  }

  const byIdentity = new Map<string, LiveSessionDto>();
  for (const row of rows) {
    const identity = row.sessionId
      ? `s:${row.sessionId}`
      : row.userId
        ? `u:${row.userId.toString()}`
        : 'anon';
    const existing = byIdentity.get(identity);
    if (existing) {
      existing.events += 1;
      // rows are sorted ts desc, so the first sighting is the latest.
      if (row.path && !existing.path) {
        existing.path = row.path;
      }
      continue;
    }
    byIdentity.set(identity, {
      identity,
      ...(row.userId ? { userId: row.userId.toString() } : {}),
      ...(row.path ? { path: row.path } : {}),
      lastTs: row.ts,
      events: 1,
    });
  }

  // Operational counts (not tracking-derived) — independent failure domain.
  let cartsWithItems = 0;
  let openCheckouts = 0;
  try {
    const [withItems, openClaims] = await Promise.all([
      CartModel.countDocuments({ 'items.0': { $exists: true } })
        .maxTimeMS(QUERY_TIME_MS)
        .exec(),
      CartModel.countDocuments({ checkoutInProgress: { $gt: staleCutoff } })
        .maxTimeMS(QUERY_TIME_MS)
        .exec(),
    ]);
    cartsWithItems = withItems;
    openCheckouts = openClaims;
  } catch (error) {
    if (!isMaxTimeError(error)) {
      throw error;
    }
    stale = true;
  }

  const sessions = [...byIdentity.values()]
    .sort((a, b) => b.lastTs.getTime() - a.lastTs.getTime())
    .slice(0, LIVE_SESSION_LIMIT);

  return {
    trackingEnabled: env.ACTIVITY_EVENTS_ENABLED,
    visitors5m: byIdentity.size,
    cartsWithItems,
    openCheckouts,
    sessions,
    generatedAt: new Date(),
    stale,
  };
};

export interface RecentActivityPage {
  items: ActivityEventDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const tsRangeFilter = (
  from: Date | undefined,
  to: Date | undefined,
): Record<string, Date> => {
  const range: Record<string, Date> = {};
  if (from) {
    range.$gte = from;
  }
  if (to) {
    range.$lte = to;
  }
  return range;
};

export const listRecentActivity = async (
  query: AdminActivityRecentQuery,
): Promise<RecentActivityPage> => {
  const filter: Record<string, unknown> = {};
  if (query.type) {
    filter.type = query.type;
  }
  if (query.source) {
    filter.source = query.source;
  }
  if (query.userId) {
    filter.userId = new Types.ObjectId(query.userId);
  }
  const range = tsRangeFilter(query.from, query.to);
  if (Object.keys(range).length > 0) {
    filter.ts = range;
  }

  const [docs, total] = await Promise.all([
    ActivityEventModel.find(filter)
      .sort({ ts: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .maxTimeMS(QUERY_TIME_MS)
      .lean()
      .exec(),
    ActivityEventModel.countDocuments(filter).maxTimeMS(QUERY_TIME_MS).exec(),
  ]);

  return {
    items: docs.map((doc) => toActivityDto(doc)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export interface OrderHistoryEntry {
  order: string;
  orderNumber: string;
  status: string;
  at: Date;
  by?: string;
}

export interface CustomerTimelineResult {
  user: { id: string; email: string; name: string; role: string; createdAt: Date };
  activity: RecentActivityPage;
  /** Flattened `orders.statusHistory` (authoritative), newest first, capped. */
  orderHistory: OrderHistoryEntry[];
  /** True when older status changes were dropped by ORDER_HISTORY_CAP (L-4). */
  orderHistoryTruncated: boolean;
  /**
   * Phase 2B-C: false ⇒ behavioral events were NOT read (tracking disabled);
   * `activity` is an empty page and only operational history is returned.
   * Historical behavioral data is never served automatically while disabled.
   */
  trackingEnabled: boolean;
}

const ORDER_HISTORY_CAP = 100;

export const getCustomerTimeline = async (
  customerId: string,
  query: AdminActivityTimelineQuery,
): Promise<CustomerTimelineResult> => {
  const user = await UserModel.findById(customerId).lean().exec();
  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  // Phase 2B-C decoupling: behavioral reads happen ONLY while tracking is
  // enabled. Disabled ⇒ no ActivityEventModel queries at all (previously
  // collected behavioral data stays inaccessible until the owner flips the
  // flag in Phase 4); operational order history remains available.
  const trackingEnabled = env.ACTIVITY_EVENTS_ENABLED;
  const range = tsRangeFilter(query.from, query.to);

  const ordersPromise = OrderModel.find({ user: user._id })
    .select({ orderNumber: 1, statusHistory: 1 })
    .sort({ createdAt: -1 })
    .limit(50)
    .maxTimeMS(QUERY_TIME_MS)
    .lean()
    .exec();

  let activity: RecentActivityPage;
  let orders: Awaited<typeof ordersPromise>;
  if (!trackingEnabled) {
    orders = await ordersPromise;
    activity = {
      items: [],
      page: query.page,
      limit: query.limit,
      total: 0,
      totalPages: 0,
    };
  } else {
    const filter: Record<string, unknown> = { userId: user._id };
    if (Object.keys(range).length > 0) {
      filter.ts = range;
    }
    const [docs, total, orderDocs] = await Promise.all([
      ActivityEventModel.find(filter)
        .sort({ ts: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .maxTimeMS(QUERY_TIME_MS)
        .lean()
        .exec(),
      ActivityEventModel.countDocuments(filter).maxTimeMS(QUERY_TIME_MS).exec(),
      ordersPromise,
    ]);
    orders = orderDocs;
    activity = {
      items: docs.map((doc) => toActivityDto(doc)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    };
  }

  const flattenedHistory: OrderHistoryEntry[] = orders
    .flatMap((order) =>
      (order.statusHistory ?? []).map((entry) => ({
        order: order._id.toString(),
        orderNumber: order.orderNumber,
        status: entry.status,
        at: entry.at,
        ...(entry.by ? { by: entry.by.toString() } : {}),
      })),
    )
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const orderHistory = flattenedHistory.slice(0, ORDER_HISTORY_CAP);

  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
    activity,
    orderHistory,
    orderHistoryTruncated: flattenedHistory.length > ORDER_HISTORY_CAP,
    trackingEnabled,
  };
};
