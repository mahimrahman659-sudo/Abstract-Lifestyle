import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  AdminAccessAuditModel,
  type AdminAccessAuditOutcome,
} from '../models/admin-access-audit.model.js';
import { TimeBudgetExceededError, withTimeBudget } from '../utils/promise-budget.js';

/**
 * Durable admin customer-access audit service (Phase 2B).
 *
 * Contract:
 * - The write is AWAITED by the caller before any identifiable data is
 *   returned; this function THROWS on failure/timeout so the caller can fail
 *   closed with a sanitized response (503 AUDIT_UNAVAILABLE).
 * - M-1: the write runs under an explicit wall-clock budget
 *   (AUDIT_WRITE_BUDGET_MS, 4 s) that bounds every phase — server selection,
 *   connection acquisition, write execution and majority/journal
 *   acknowledgment. No retries are ever performed.
 * - M-2: the model enforces write concern { w: "majority", j: true }; there
 *   is no w:1 fallback. If majority acknowledgment cannot be obtained the
 *   write rejects and the request is denied.
 * - Documented edge case: if the time budget expires first, the underlying
 *   write MAY still complete afterwards — an audit record can then exist
 *   although the response was denied (extra record, never a missing one;
 *   the orphan outcome is logged when it settles).
 * - This is the security audit mechanism for identifiable customer reads.
 *   Best-effort activity events (admin.customer_viewed) are supplementary
 *   feed data only and are NEVER relied on for security auditing.
 * - Stores ids/enums/timestamps only — no personal data, no request bodies.
 */

/** Audit write wall-clock budget (Phase 2B M-1 target: 3–5 s). */
export const AUDIT_WRITE_BUDGET_MS = 4_000;

export interface RecordCustomerTimelineAccessInput {
  adminId: Types.ObjectId;
  /** Already validated as an ObjectId by adminIdParamsSchema. */
  targetCustomerId: string;
  outcome: AdminAccessAuditOutcome;
  /** Server-generated UUID v4 for this request (echoed to the client). */
  correlationId: string;
}

export interface RecordedCustomerTimelineAccess {
  auditId: string;
  correlationId: string;
}

export const recordCustomerTimelineAccess = async (
  input: RecordCustomerTimelineAccessInput,
): Promise<RecordedCustomerTimelineAccess> => {
  const auditId = randomUUID();
  // `create` validates and inserts under the model's majority+journal write
  // concern; any failure (incl. majority unavailability) rejects and the
  // caller must fail closed — identifiable data is never returned.
  const write = AdminAccessAuditModel.create({
    auditId,
    adminId: input.adminId,
    action: 'customer.timeline.viewed',
    targetCustomerId: new Types.ObjectId(input.targetCustomerId),
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
