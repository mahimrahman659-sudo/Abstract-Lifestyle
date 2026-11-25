import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import {
  adminActivityRecentQuerySchema,
  adminActivityTimelineQuerySchema,
  adminIdParamsSchema,
} from '../schemas/admin.schema.js';
import { getAuthUser } from '../middleware/auth.js';
import { emitServerEvent } from '../services/activity.service.js';
import {
  getCustomerTimeline,
  getLiveActivity,
  listRecentActivity,
} from '../services/admin-activity.service.js';

/** GET /api/admin/activity/live — near-real-time visitor panel (approximate). */
export const adminLiveActivityHandler: RequestHandler = async (_req, res) => {
  res.status(200).json(await getLiveActivity());
};

/** GET /api/admin/activity/recent — paginated, filterable feed. */
export const adminRecentActivityHandler: RequestHandler = async (req, res) => {
  const query = adminActivityRecentQuerySchema.parse(req.query);
  res.status(200).json(await listRecentActivity(query));
};

/**
 * GET /api/admin/activity/customers/:id/timeline — identifiable customer
 * activity + authoritative order status history.
 *
 * H-1 FEATURE GATE (Phase 2 independent review): while
 * ACTIVITY_EVENTS_ENABLED=false this endpoint answers a sanitized 503 and
 * serves NO customer data, because the `admin.customer_viewed` access-audit
 * event is itself flag-gated — an identifiable read that cannot be recorded
 * must not be served. Authorization is unaffected: 401/403 still happen in
 * the router guard before this handler runs. The pre-existing
 * GET /api/admin/customers/:id detail endpoint is intentionally unchanged.
 *
 * IMPORTANT: `admin.customer_viewed` is a BEST-EFFORT activity event, not a
 * guaranteed audit trail (it can be lost on storage failure and expires with
 * the TTL). A separate, durable admin-access audit mechanism — or an explicit
 * owner acceptance of best-effort coverage — is REQUIRED before identifiable
 * timelines are enabled in production (flag on). Tracked as a Phase 4
 * precondition; see CUSTOMER_ACTIVITY_PHASE2_CORRECTIVE_REPORT.md.
 */
export const adminCustomerTimelineHandler: RequestHandler = async (req, res) => {
  if (!env.ACTIVITY_EVENTS_ENABLED) {
    res.status(503).json({
      error: {
        code: 'ACTIVITY_DISABLED',
        message: 'The activity timeline is unavailable while activity tracking is disabled.',
      },
    });
    return;
  }
  const { id } = adminIdParamsSchema.parse(req.params);
  const query = adminActivityTimelineQuerySchema.parse(req.query);
  const admin = getAuthUser(req);
  const result = await getCustomerTimeline(id, query);
  emitServerEvent({
    type: 'admin.customer_viewed',
    userId: admin._id,
    customerId: result.user.id,
  });
  res.status(200).json(result);
};
