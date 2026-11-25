import mongoose from 'mongoose';
import { withTimeBudget, TimeBudgetExceededError } from '../utils/promise-budget.js';
import {
  ADMIN_ACCESS_AUDIT_COLLECTION_NAME,
  ADMIN_ACCESS_AUDIT_TTL_SECONDS,
} from '../models/admin-access-audit.model.js';

/**
 * Admin customer-access AUDIT index readiness (Phase 2B, review finding H-1).
 *
 * Mirrors the verified payment/activity index-verification patterns
 * (`config/payment-index.ts`, `config/activity-index.ts`) but is deliberately
 * INDEPENDENT of ACTIVITY_EVENTS_ENABLED: audit infrastructure readiness is
 * a security property of the protected timeline, not of behavioral tracking.
 *
 * Behavior contract:
 * - verifies ALL FOUR designed indexes: ordered key pairs, uniqueness,
 *   sparsity, exact TTL, hidden/collation options — never names/counts alone;
 * - a missing collection counts as "all indexes missing" (never ready);
 * - an inspection ERROR or budget overrun is NEVER interpreted as ready;
 * - readiness is cached for a bounded window (READINESS_CACHE_TTL_MS) so
 *   requests do not enumerate indexes every time; `invalidate…()` provides
 *   safe immediate invalidation (tests, post-rollout operations);
 * - documented staleness bounds after an index change:
 *     · indexes deleted   → cached "ready" may serve the timeline for at
 *       most 60 s (audit WRITES are still acknowledged — enforcement is
 *       unaffected; only detection/retention lag is bounded by the window);
 *     · indexes restored  → cached "not ready" keeps the timeline gated for
 *       at most 60 s (fail-closed direction), recoverable instantly via
 *       invalidate…();
 * - read-only: this module NEVER creates collections or indexes.
 */

export interface AuditIndexInfo {
  name?: unknown;
  key?: unknown;
  unique?: unknown;
  sparse?: unknown;
  expireAfterSeconds?: unknown;
  collation?: unknown;
  hidden?: unknown;
}

export interface AdminAccessAuditIndexReadiness {
  ready: boolean;
  reason: string;
}

export interface AdminAccessAuditIndexSpec {
  name: string;
  /** Ordered [field, direction] pairs — index key ORDER is significant. */
  key: ReadonlyArray<readonly [string, number]>;
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds: number | null;
}

/** All four designed indexes for `admin_access_audit` (exact definitions). */
export const ADMIN_ACCESS_AUDIT_INDEX_SPECS: readonly AdminAccessAuditIndexSpec[] = [
  {
    name: 'audit_auditId_unique',
    key: [['auditId', 1]],
    unique: true,
    sparse: false,
    expireAfterSeconds: null,
  },
  {
    name: 'audit_at_ttl',
    key: [['at', 1]],
    unique: false,
    sparse: false,
    expireAfterSeconds: ADMIN_ACCESS_AUDIT_TTL_SECONDS,
  },
  {
    name: 'audit_admin_at',
    key: [['adminId', 1], ['at', -1]],
    unique: false,
    sparse: false,
    expireAfterSeconds: null,
  },
  {
    name: 'audit_target_at',
    key: [['targetCustomerId', 1], ['at', -1]],
    unique: false,
    sparse: false,
    expireAfterSeconds: null,
  },
];

const orderedKeyEntries = (key: unknown): Array<[string, unknown]> => {
  if (key === null || typeof key !== 'object' || Array.isArray(key)) {
    return [];
  }
  return Object.entries(key as Record<string, unknown>);
};

const sameOrderedKey = (
  actual: Array<[string, unknown]>,
  spec: AdminAccessAuditIndexSpec['key'],
): boolean => {
  if (actual.length !== spec.length) {
    return false;
  }
  return spec.every(
    ([field, direction], index) =>
      actual[index]?.[0] === field && actual[index]?.[1] === direction,
  );
};

/**
 * Pure evaluation of discovered index metadata against the four specs.
 * Ordered keys, uniqueness, sparsity, exact TTL, hidden and collation are
 * all checked — a wrong value on any of them fails readiness.
 */
export const evaluateAdminAccessAuditIndexes = (
  indexes: readonly AuditIndexInfo[],
): AdminAccessAuditIndexReadiness => {
  for (const spec of ADMIN_ACCESS_AUDIT_INDEX_SPECS) {
    const actual = indexes.find((item) => item.name === spec.name);
    if (!actual) {
      return {
        ready: false,
        reason: `the required index "${spec.name}" is missing`,
      };
    }
    if (!sameOrderedKey(orderedKeyEntries(actual.key), spec.key)) {
      return {
        ready: false,
        reason: `the index "${spec.name}" has the wrong key pattern or key order`,
      };
    }
    if ((actual.unique === true) !== spec.unique) {
      return {
        ready: false,
        reason: spec.unique
          ? `the index "${spec.name}" is not unique`
          : `the index "${spec.name}" must not be unique`,
      };
    }
    if ((actual.sparse === true) !== spec.sparse) {
      return {
        ready: false,
        reason: spec.sparse
          ? `the index "${spec.name}" must be sparse`
          : `the index "${spec.name}" must not be sparse`,
      };
    }
    const ttl =
      typeof actual.expireAfterSeconds === 'number' ? actual.expireAfterSeconds : null;
    if (ttl !== spec.expireAfterSeconds) {
      return {
        ready: false,
        reason:
          spec.expireAfterSeconds === null
            ? `the index "${spec.name}" must not have an expiry option`
            : `the index "${spec.name}" has the wrong expiry (expected ${String(
                spec.expireAfterSeconds,
              )}, found ${ttl === null ? 'none' : String(ttl)})`,
      };
    }
    if (actual.hidden === true) {
      return { ready: false, reason: `the index "${spec.name}" is hidden` };
    }
    if (actual.collation !== undefined && actual.collation !== null) {
      return { ready: false, reason: `the index "${spec.name}" has a collation` };
    }
  }
  return {
    ready: true,
    reason: 'all required admin-access-audit indexes are present and correct',
  };
};

const isNamespaceNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  const codeName = (error as { codeName?: unknown }).codeName;
  return code === 26 || codeName === 'NamespaceNotFound';
};

/** Inspection wall-clock budget (fail closed when exceeded). */
export const AUDIT_INSPECT_BUDGET_MS = 2_000;
/** Bounded validity of the cached readiness verdict. */
export const AUDIT_READINESS_CACHE_TTL_MS = 60_000;

type DatabaseHandle = NonNullable<typeof mongoose.connection.db>;

/**
 * Reads live index metadata for `admin_access_audit` (read-only, bounded).
 * A missing collection is "all missing"; any other failure — including the
 * inspection time budget — fails closed. An inspection error is NEVER ready.
 */
export const inspectAdminAccessAuditIndexes = async (
  db: DatabaseHandle,
): Promise<AdminAccessAuditIndexReadiness> => {
  try {
    const indexes = (await withTimeBudget(
      db.collection(ADMIN_ACCESS_AUDIT_COLLECTION_NAME).indexes() as Promise<
        AuditIndexInfo[]
      >,
      AUDIT_INSPECT_BUDGET_MS,
    )) as AuditIndexInfo[];
    return evaluateAdminAccessAuditIndexes(indexes);
  } catch (error) {
    if (error instanceof TimeBudgetExceededError) {
      return {
        ready: false,
        reason: 'the audit index inspection exceeded its time budget',
      };
    }
    if (isNamespaceNotFound(error)) {
      return evaluateAdminAccessAuditIndexes([]);
    }
    return {
      ready: false,
      reason: 'the audit index metadata could not be inspected',
    };
  }
};

interface CachedReadiness {
  at: number;
  readiness: AdminAccessAuditIndexReadiness;
}

let readinessCache: CachedReadiness | null = null;

/**
 * Safe invalidation: clears the bounded cache so the next request recomputes
 * against live index metadata (call after index rollouts and in tests that
 * mutate indexes).
 */
export const invalidateAdminAccessAuditReadinessCache = (): void => {
  readinessCache = null;
};

/**
 * Cached readiness for the default connection. Bounded by
 * AUDIT_READINESS_CACHE_TTL_MS; disconnected databases fail closed
 * immediately (no buffering wait). Refusals are logged once per cache
 * window (message-only, no payloads).
 */
export const getAdminAccessAuditReadiness =
  async (): Promise<AdminAccessAuditIndexReadiness> => {
    const now = Date.now();
    if (
      readinessCache !== null &&
      now - readinessCache.at < AUDIT_READINESS_CACHE_TTL_MS
    ) {
      return readinessCache.readiness;
    }

    let readiness: AdminAccessAuditIndexReadiness;
    if (mongoose.connection.readyState !== 1) {
      readiness = { ready: false, reason: 'the database is not connected' };
    } else {
      const db = mongoose.connection.db;
      if (!db) {
        readiness = { ready: false, reason: 'no database handle is available' };
      } else {
        readiness = await inspectAdminAccessAuditIndexes(db);
      }
    }

    readinessCache = { at: Date.now(), readiness };
    if (!readiness.ready) {
      console.error(`[access-audit] readiness refused: ${readiness.reason}`);
    }
    return readiness;
  };
