import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { getAdminAccessAuditReadiness } from '../config/admin-access-audit-index.js';
import {
  AdminAccessAuditModel,
  type AdminAccessAuditAction,
  type AdminAccessAuditOutcome,
} from '../models/admin-access-audit.model.js';
import { TimeBudgetExceededError, withTimeBudget } from '../utils/promise-budget.js';

/**
 * Durable admin customer-access audit service (Phase 2B, extended 2C).
 *
 * Contract:
 * - The write is AWAITED before any identifiable data is returned; failures
 *   THROW so callers fail closed with a sanitized 503 AUDIT_UNAVAILABLE.
 * - M-1: every write runs under AUDIT_WRITE_BUDGET_MS (4 s wall-clock,
 *   covering server selection, connection acquisition, execution and
 *   majority/journal acknowledgment). No retries — one attempt per request,
 *   so a single request can never produce uncontrolled duplicate writes.
 * - M-2: model write concern { w: "majority", j: true } — no w:1 fallback.
 * - Documented edge case: if the budget expires first the write MAY still
 *   complete later — a record can exist although the response was denied
 *   (extra record, never a missing one; late outcome logged).
 * - Best-effort activity events are NEVER the security audit.
 * - Stores ids/enums/counts/timestamps only — no personal data, no search
 *   terms, no id lists, no response bodies.
 *
 * Phase 2C: `performAuditedAdminRead` wraps the four legacy customer/order
 * admin endpoints behind the same readiness → load → persist → fail-closed
 * chain, gated by ADMIN_ACCESS_AUDIT_LEGACY_ENABLED in the controllers.
 */

/** Audit write wall-clock budget (Phase 2B M-1 target: 3–5 s). */
export const AUDIT_WRITE_BUDGET_MS = 4_000;

export interface RecordedAdminAccessAudit {
  auditId: string;
  correlationId: string;
}

export interface RecordAdminAccessAuditInput {
  action: AdminAccessAuditAction;
  adminId: Types.ObjectId;
  /** Server-generated UUID v4 for this request (echoed as X-Audit-Id). */
  correlationId: string;
  outcome: AdminAccessAuditOutcome;
  /** Pre-validated ObjectId string (adminIdParamsSchema / service ids). */
  targetCustomerId?: string;
  /** Pre-validated ObjectId string (adminIdParamsSchema). */
  targetOrderId?: string;
  /** Bulk metadata: total rows for the request (bounded by schema). */
  resultCount?: number;
  /** Bulk metadata: requested page (bounded by schema). */
  page?: number;
}

/**
 * Persists one durable audit record under the majority+journal write
 * concern and the bounded time budget. Throws on any failure/timeout.
 */
export const recordAdminAccessAudit = async (
  input: RecordAdminAccessAuditInput,
): Promise<RecordedAdminAccessAudit> => {
  const auditId = randomUUID();
  const targetCustomerId = input.targetCustomerId
    ? new Types.ObjectId(input.targetCustomerId)
    : undefined;
  const targetOrderId = input.targetOrderId
    ? new Types.ObjectId(input.targetOrderId)
    : undefined;

  // `create` validates and inserts under the model's majority+journal write
  // concern; any failure (incl. majority unavailability) rejects and the
  // caller must fail closed — identifiable data is never returned.
  const write = AdminAccessAuditModel.create({
    auditId,
    adminId: input.adminId,
    action: input.action,
    ...(targetCustomerId ? { targetCustomerId } : {}),
    ...(targetOrderId ? { targetOrderId } : {}),
    ...(input.resultCount !== undefined ? { resultCount: input.resultCount } : {}),
    ...(input.page !== undefined ? { page: input.page } : {}),
    at: new Date(),
    outcome: input.outcome,
    correlationId: input.correlationId,
  });

  // Observe the orphan outcome if the time budget wins the race: the write
  // remains subscribed (no unhandled rejections) and its late settlement is
  // documented — a record may exist although the response was denied.
  let budgetExceeded = false;
  void write.then(
    () => {
      if (budgetExceeded) {
        console.error(
          '[access-audit] orphaned write completed after the time budget — a record may exist although the response was denied',
        );
      }
    },
    () => {
      if (budgetExceeded) {
        console.error('[access-audit] orphaned write failed after the time budget');
      }
    },
  );

  try {
    await withTimeBudget(write, AUDIT_WRITE_BUDGET_MS);
  } catch (error) {
    budgetExceeded = error instanceof TimeBudgetExceededError;
    throw error;
  }

  return { auditId, correlationId: input.correlationId };
};

/** Timeline specialization (Phase 2B contract preserved verbatim). */
export interface RecordCustomerTimelineAccessInput {
  adminId: Types.ObjectId;
  targetCustomerId: string;
  outcome: AdminAccessAuditOutcome;
  correlationId: string;
}

export const recordCustomerTimelineAccess = async (
  input: RecordCustomerTimelineAccessInput,
): Promise<RecordedAdminAccessAudit> =>
  recordAdminAccessAudit({
    action: 'customer.timeline.viewed',
    adminId: input.adminId,
    correlationId: input.correlationId,
    outcome: input.outcome,
    targetCustomerId: input.targetCustomerId,
  });

export interface PerformAuditedAdminReadOptions<T> {
  action: AdminAccessAuditAction;
  adminId: Types.ObjectId;
  /** Individual-access target (customer detail / lists never set targets). */
  targetCustomerId?: string;
  targetOrderId?: string;
  /** Page for list actions (bulk metadata). */
  page?: number;
  /** Loads the protected data; may throw AppError 404 (not found). */
  load: () => Promise<{ data: T; resultCount?: number }>;
}

export interface AuditedAdminReadResult<T> {
  /** null ⇒ the target was not found (already audited with outcome `not_found`). */
  data: T | null;
  correlationId: string;
}

const AUDIT_NOT_READY_MESSAGE =
  'This view is temporarily unavailable because access auditing is not ready.';
const AUDIT_NOT_RECORDED_MESSAGE =
  'This view is temporarily unavailable because access auditing could not be recorded.';

/**
 * Shared fail-closed enforcement for protected admin reads (Phase 2C):
 * readiness → load → durable audit (majority + 4 s budget) → return, or
 * sanitized 503 AUDIT_UNAVAILABLE at any audit-infrastructure failure.
 *
 * Not-found attempts are audited with outcome `not_found` first; the caller
 * receives `data: null` plus the correlation id so it can echo the
 * `X-Audit-Id` header before throwing its own 404 (same contract as the
 * customer timeline). Non-404 load failures disclose nothing and are
 * rethrown untouched (no record — no data was produced).
 */
export const performAuditedAdminRead = async <T>(
  options: PerformAuditedAdminReadOptions<T>,
): Promise<AuditedAdminReadResult<T>> => {
  const correlationId = randomUUID();

  const readiness = await getAdminAccessAuditReadiness();
  if (!readiness.ready) {
    throw new AppError(503, 'AUDIT_UNAVAILABLE', AUDIT_NOT_READY_MESSAGE);
  }

  let data: T | null;
  let resultCount: number | undefined;
  try {
    const loaded = await options.load();
    data = loaded.data;
    resultCount = loaded.resultCount;
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      try {
        await recordAdminAccessAudit({
          action: options.action,
          adminId: options.adminId,
          correlationId,
          outcome: 'not_found',
          ...(options.targetCustomerId ? { targetCustomerId: options.targetCustomerId } : {}),
          ...(options.targetOrderId ? { targetOrderId: options.targetOrderId } : {}),
          ...(options.page !== undefined ? { page: options.page } : {}),
        });
      } catch (auditError) {
        logAuditPersistenceFailure(auditError);
        throw new AppError(503, 'AUDIT_UNAVAILABLE', AUDIT_NOT_RECORDED_MESSAGE);
      }
      // Audited: hand the correlation id to the caller for the 404 response.
      return { data: null, correlationId };
    }
    // Non-404 failure: no identifiable data was produced → no record needed.
    throw error;
  }

  if (data === null) {
    // load() returned null defensively — audit it like a not-found.
    try {
      await recordAdminAccessAudit({
        action: options.action,
        adminId: options.adminId,
        correlationId,
        outcome: 'not_found',
        ...(options.targetCustomerId ? { targetCustomerId: options.targetCustomerId } : {}),
        ...(options.targetOrderId ? { targetOrderId: options.targetOrderId } : {}),
        ...(options.page !== undefined ? { page: options.page } : {}),
      });
    } catch (auditError) {
      logAuditPersistenceFailure(auditError);
      throw new AppError(503, 'AUDIT_UNAVAILABLE', AUDIT_NOT_RECORDED_MESSAGE);
    }
    return { data: null, correlationId };
  }

  try {
    await recordAdminAccessAudit({
      action: options.action,
      adminId: options.adminId,
      correlationId,
      outcome: 'success',
      ...(options.targetCustomerId ? { targetCustomerId: options.targetCustomerId } : {}),
      ...(options.targetOrderId ? { targetOrderId: options.targetOrderId } : {}),
      ...(resultCount !== undefined ? { resultCount } : {}),
      ...(options.page !== undefined ? { page: options.page } : {}),
    });
  } catch (auditError) {
    logAuditPersistenceFailure(auditError);
    // Fail closed: loaded data is discarded, never returned.
    throw new AppError(503, 'AUDIT_UNAVAILABLE', AUDIT_NOT_RECORDED_MESSAGE);
  }

  return { data, correlationId };
};

/**
 * Message-only failure logging (never audit payloads). Endpoint-like
 * substrings (host:port) are redacted so driver messages such as
 * "…waiting for server at 127.0.0.1:27017" do not leak topology (L-1).
 */
export const sanitizeAuditLogMessage = (message: string): string =>
  message.replace(/\b[\w.-]+:\d{2,5}\b/g, '[endpoint]').slice(0, 300);

export const logAuditPersistenceFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[access-audit] persistence failed: ${sanitizeAuditLogMessage(message)}`);
};
