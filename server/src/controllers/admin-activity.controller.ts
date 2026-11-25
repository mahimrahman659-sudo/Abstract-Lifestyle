import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../middleware/error-handler.js';
import { getAdminAccessAuditReadiness } from '../config/admin-access-audit-index.js';
import {
  adminActivityRecentQuerySchema,
  adminActivityTimelineQuerySchema,
  adminIdParamsSchema,
} from '../schemas/admin.schema.js';
import { getAuthUser } from '../middleware/auth.js';
import { emitServerEvent } from '../services/activity.service.js';
import {
  logAuditPersistenceFailure,
  recordCustomerTimelineAccess,
} from '../services/admin-access-audit.service.js';
import {
  getCustomerTimeline,
  getLiveActivity,
  listRecentActivity,
  type CustomerTimelineResult,
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
 * activity (only while behavioral tracking is enabled) plus authoritative
 * operational order history.
 *
 * SECURITY (Phase 2B — supersedes the temporary Phase 2 flag gate):
 * 1. Router-level `requireAuth + requireRole('admin')` runs first (401/403).
 * 2. Request validation runs next (400).
 * 3. H-1: AUDIT-INDEX READINESS gate (flag-independent, cached/bounded) —
 *    if the four designed audit indexes are missing, mismatched or the
 *    inspection fails, the request fails closed with a sanitized 503 before
 *    any customer data is loaded. Storefront, checkout, payment and all
 *    other admin endpoints are unaffected.
 * 4. The timeline is loaded, then a DURABLE audit record
 *    (`admin_access_audit`, majority+journal write concern, 4 s budget) is
 *    awaited BEFORE any identifiable data is returned. If persistence fails
 *    or times out, the loaded data is discarded and the request fails closed
 *    with a sanitized 503 AUDIT_UNAVAILABLE.
 * 5. The best-effort `admin.customer_viewed` activity event (supplementary
 *    feed data only) is emitted afterwards; it is NEVER the security audit.
 *
 * DECOUPLING (Phase 2B-C): while ACTIVITY_EVENTS_ENABLED=false no behavioral
 * events are collected and previously collected behavioral data is NOT read —
 * the response carries operational order history only, still behind the
 * durable audit. Enabling behavioral access remains an owner-gated flag flip
 * (Phase 4), never automatic.
 */
export const adminCustomerTimelineHandler: RequestHandler = async (req, res) => {
  const correlationId = randomUUID();
  const { id } = adminIdParamsSchema.parse(req.params);
  const query = adminActivityTimelineQuerySchema.parse(req.query);
  const admin = getAuthUser(req);

  // H-1: fail closed when audit infrastructure is unavailable — regardless
  // of the behavioral flag (readiness never consults ACTIVITY_EVENTS_ENABLED).
  const readiness = await getAdminAccessAuditReadiness();
  if (!readiness.ready) {
    res.status(503).json({
      error: {
        code: 'AUDIT_UNAVAILABLE',
        message: 'This view is temporarily unavailable because access auditing is not ready.',
      },
    });
    return;
  }

  // Load first so the audit outcome reflects reality (success vs not_found);
  // the loaded data is returned ONLY after the durable write below succeeds.
  let result: CustomerTimelineResult | null = null;
  let outcome: 'success' | 'not_found' = 'success';
  try {
    result = await getCustomerTimeline(id, query);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      outcome = 'not_found';
    } else {
      throw error;
    }
  }

  try {
    await recordCustomerTimelineAccess({
      adminId: admin._id,
      targetCustomerId: id,
      outcome,
      correlationId,
    });
  } catch (error) {
    logAuditPersistenceFailure(error);
    // Fail closed: identifiable data (if loaded) is discarded, never returned.
    res.status(503).json({
      error: {
        code: 'AUDIT_UNAVAILABLE',
        message:
          'This view is temporarily unavailable because access auditing could not be recorded.',
      },
    });
    return;
  }

  res.setHeader('X-Audit-Id', correlationId);
  if (!result) {
    // Audit for the attempt was persisted above; the customer does not exist.
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  // Supplementary activity-feed event (no-op while tracking is disabled).
  emitServerEvent({
    type: 'admin.customer_viewed',
    userId: admin._id,
    customerId: result.user.id,
  });
  res.status(200).json(result);
};
