import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * Durable ADMIN CUSTOMER-ACCESS AUDIT (Phase 2B).
 *
 * Security audit trail for identifiable customer reads by administrators.
 * Deliberately INDEPENDENT of ACTIVITY_EVENTS_ENABLED: enforcement does not
 * depend on behavioral tracking, its best-effort events, or their TTL.
 *
 * Minimum-necessary fields only. NEVER stored here: passwords, tokens, OTPs,
 * payment transaction references, addresses, raw IP addresses, user agents,
 * response bodies, e-mail addresses, names or any other personal data beyond
 * the two object ids required to answer "which admin viewed which customer,
 * when, with what outcome".
 *
 * Indexes below are explicit, reviewed definitions. They are created only in
 * disposable *_test databases (syncIndexes in tests); production creation is
 * a separate owner-approved rollout (see the Phase 2B report's migration
 * plan). Retention is enforced by the TTL index once rolled out.
 */

/** Actions this audit trail can record (extend explicitly, never open-ended). */
export const ADMIN_ACCESS_AUDIT_ACTIONS = ['customer.timeline.viewed'] as const;
export type AdminAccessAuditAction = (typeof ADMIN_ACCESS_AUDIT_ACTIONS)[number];

/**
 * Sanitized outcomes — enum values only, never free-text messages
 * (messages could echo personal data).
 * - `success`:   identifiable timeline data was served;
 * - `not_found`: the requested customer does not exist (no data served).
 */
export const ADMIN_ACCESS_AUDIT_OUTCOMES = ['success', 'not_found'] as const;
export type AdminAccessAuditOutcome = (typeof ADMIN_ACCESS_AUDIT_OUTCOMES)[number];

/**
 * Retention: 365 days (PROPOSAL — owner approval required before production
 * activation; see CUSTOMER_ACTIVITY_PHASE2B_IMPLEMENTATION_REPORT.md).
 */
export const ADMIN_ACCESS_AUDIT_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Pinned collection name (mongoose would otherwise pluralize). */
export const ADMIN_ACCESS_AUDIT_COLLECTION_NAME = 'admin_access_audit';

export interface AdminAccessAudit {
  /** Server-generated UUID v4 — unique identifier of this audit record. */
  auditId: string;
  /** Authenticated administrator (resolved server-side from the verified cookie). */
  adminId: Types.ObjectId;
  action: AdminAccessAuditAction;
  targetCustomerId: Types.ObjectId;
  /** Server-generated timestamp. */
  at: Date;
  outcome: AdminAccessAuditOutcome;
  /** Server-generated per-request correlation id (echoed as X-Audit-Id). */
  correlationId: string;
}

export type AdminAccessAuditDocument = HydratedDocument<AdminAccessAudit>;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const adminAccessAuditSchema = new Schema<AdminAccessAudit>(
  {
    auditId: {
      type: String,
      required: true,
      match: [UUID_V4_PATTERN, 'auditId must be a UUID v4'],
    },
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: [...ADMIN_ACCESS_AUDIT_ACTIONS], required: true },
    targetCustomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    outcome: { type: String, enum: [...ADMIN_ACCESS_AUDIT_OUTCOMES], required: true },
    correlationId: {
      type: String,
      required: true,
      match: [UUID_V4_PATTERN, 'correlationId must be a UUID v4'],
    },
  },
  {
    // Immutable security record: `at` only — no updatedAt churn and no
    // version-key artifact (the stored key set stays exactly the seven
    // audited fields).
    timestamps: false,
    versionKey: false,
    // M-2 (Phase 2B review): EVERY audit write requires majority + journal
    // acknowledgment. Scoped to this collection only — checkout/payment/
    // cart writes are untouched. No w:1 fallback path exists: if majority
    // acknowledgment cannot be obtained the write rejects and the caller
    // fails closed (503, no data). Journaling is WiredTiger-default ON and
    // j:true is compatible with w:"majority" on replica sets (verified in
    // the disposable replica-set test suite).
    writeConcern: { w: 'majority', j: true },
  },
);

// --- Explicit reviewed index definitions (disposable DBs only in tests) ---

/** Unique audit identifier (defense in depth for server-generated ids). */
adminAccessAuditSchema.index(
  { auditId: 1 },
  { unique: true, name: 'audit_auditId_unique' },
);

/** Retention (TTL) — enforced once the Phase 2B index rollout lands. */
adminAccessAuditSchema.index(
  { at: 1 },
  { expireAfterSeconds: ADMIN_ACCESS_AUDIT_TTL_SECONDS, name: 'audit_at_ttl' },
);

/** "Which admin accessed customers, most recent first" (forensics). */
adminAccessAuditSchema.index(
  { adminId: 1, at: -1 },
  { name: 'audit_admin_at' },
);

/** "Who viewed this customer, most recent first" (per-customer trail). */
adminAccessAuditSchema.index(
  { targetCustomerId: 1, at: -1 },
  { name: 'audit_target_at' },
);

export const AdminAccessAuditModel = model<AdminAccessAudit>(
  'AdminAccessAudit',
  adminAccessAuditSchema,
  ADMIN_ACCESS_AUDIT_COLLECTION_NAME,
);
