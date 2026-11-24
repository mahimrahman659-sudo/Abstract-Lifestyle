import mongoose from 'mongoose';
import { env } from './env.js';
import {
  ACTIVITY_COLLECTION_NAME,
  ACTIVITY_EVENT_TTL_SECONDS,
} from '../models/activity-event.model.js';

/**
 * Activity index readiness gate (Phase 1B-A, review finding R-1).
 *
 * Mirrors the payment-index safety pattern (`config/payment-index.ts`):
 * when `ACTIVITY_EVENTS_ENABLED=true` the API refuses to start — and the
 * ingest path refuses to write — unless every designed activity index
 * exists with the exact key order, uniqueness, sparsity and TTL. Indexes
 * are NEVER created here; creation stays a separately authorized rollout.
 *
 * When the flag is false nothing is required (the flag itself guarantees
 * zero persistence), so this gate cannot block the disabled deployment.
 */

export interface IndexInfo {
  name?: unknown;
  key?: unknown;
  unique?: unknown;
  sparse?: unknown;
  expireAfterSeconds?: unknown;
  collation?: unknown;
  hidden?: unknown;
}

export interface ActivityIndexReadiness {
  ready: boolean;
  required: boolean;
  reason: string;
}

export interface ActivityIndexSpec {
  name: string;
  /** Ordered [field, direction] pairs — index key ORDER is significant. */
  key: ReadonlyArray<readonly [string, number]>;
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds: number | null;
}

/** Exact designed indexes for `activity_events` (plan §5.5). */
export const ACTIVITY_INDEX_SPECS: readonly ActivityIndexSpec[] = [
  {
    name: 'activity_eventId_unique',
    key: [['eventId', 1]],
    unique: true,
    sparse: false,
    expireAfterSeconds: null,
  },
  {
    name: 'activity_ts_ttl',
    key: [['ts', 1]],
    unique: false,
    sparse: false,
    expireAfterSeconds: ACTIVITY_EVENT_TTL_SECONDS,
  },
  {
    name: 'activity_type_ts',
    key: [
      ['type', 1],
      ['ts', -1],
    ],
    unique: false,
    sparse: false,
    expireAfterSeconds: null,
  },
  {
    name: 'activity_userId_ts',
    key: [
      ['userId', 1],
      ['ts', -1],
    ],
    unique: false,
    sparse: true,
    expireAfterSeconds: null,
  },
  {
    name: 'activity_sessionId_ts',
    key: [
      ['sessionId', 1],
      ['ts', -1],
    ],
    unique: false,
    sparse: false,
    expireAfterSeconds: null,
  },
  {
    name: 'activity_productId_ts',
    key: [
      ['productId', 1],
      ['ts', -1],
    ],
    unique: false,
    sparse: false,
    expireAfterSeconds: null,
  },
];

const orderedKeyEntries = (key: unknown): Array<[string, unknown]> => {
  if (key === null || typeof key !== 'object' || Array.isArray(key)) {
    return [];
  }
  // BSON preserves index key order; Object.entries keeps it for string keys.
  return Object.entries(key as Record<string, unknown>);
};

const sameOrderedKey = (actual: Array<[string, unknown]>, spec: ActivityIndexSpec['key']): boolean => {
  if (actual.length !== spec.length) {
    return false;
  }
  return spec.every(
    ([field, direction], index) =>
      actual[index]?.[0] === field && actual[index]?.[1] === direction,
  );
};

/**
 * Pure evaluation of discovered index metadata against the designed specs.
 * Verifies key ORDER, uniqueness, sparsity and exact TTL — never just names.
 */
export const evaluateActivityIndexes = (
  indexes: readonly IndexInfo[],
  required: boolean,
): ActivityIndexReadiness => {
  if (!required) {
    return {
      ready: true,
      required: false,
      reason: 'activity events are disabled',
    };
  }

  for (const spec of ACTIVITY_INDEX_SPECS) {
    const actual = indexes.find((item) => item.name === spec.name);
    if (!actual) {
      return {
        ready: false,
        required: true,
        reason: `the required index "${spec.name}" is missing`,
      };
    }
    if (!sameOrderedKey(orderedKeyEntries(actual.key), spec.key)) {
      return {
        ready: false,
        required: true,
        reason: `the index "${spec.name}" has the wrong key pattern or key order`,
      };
    }
    if ((actual.unique === true) !== spec.unique) {
      return {
        ready: false,
        required: true,
        reason: spec.unique
          ? `the index "${spec.name}" is not unique`
          : `the index "${spec.name}" must not be unique`,
      };
    }
    if ((actual.sparse === true) !== spec.sparse) {
      return {
        ready: false,
        required: true,
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
        required: true,
        reason:
          spec.expireAfterSeconds === null
            ? `the index "${spec.name}" must not have an expiry option`
            : `the index "${spec.name}" has the wrong expiry (expected ${String(
                spec.expireAfterSeconds,
              )}, found ${ttl === null ? 'none' : String(ttl)})`,
      };
    }
    if (actual.hidden === true) {
      return {
        ready: false,
        required: true,
        reason: `the index "${spec.name}" is hidden`,
      };
    }
    if (actual.collation !== undefined && actual.collation !== null) {
      return {
        ready: false,
        required: true,
        reason: `the index "${spec.name}" has a collation`,
      };
    }
  }

  return {
    ready: true,
    required: true,
    reason: 'all required activity indexes are present and correct',
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

type DatabaseHandle = NonNullable<typeof mongoose.connection.db>;

/**
 * Reads the live index metadata for `activity_events`. A missing collection
 * is treated as "no indexes" (everything required is missing) — never as
 * ready. Any other inspection failure fails closed.
 */
export const inspectActivityIndexes = async (
  db: DatabaseHandle,
): Promise<ActivityIndexReadiness> => {
  try {
    const indexes = (await db
      .collection(ACTIVITY_COLLECTION_NAME)
      .indexes()) as unknown as IndexInfo[];
    return evaluateActivityIndexes(indexes, true);
  } catch (error) {
    if (isNamespaceNotFound(error)) {
      return evaluateActivityIndexes([], true);
    }
    return {
      ready: false,
      required: true,
      reason: 'the activity index metadata could not be inspected',
    };
  }
};

/** Readiness of the default connection, honoring the feature flag. */
export const getActivityIndexReadiness = async (): Promise<ActivityIndexReadiness> => {
  if (!env.ACTIVITY_EVENTS_ENABLED) {
    return evaluateActivityIndexes([], false);
  }
  if (mongoose.connection.readyState !== 1) {
    return {
      ready: false,
      required: true,
      reason: 'the database is not connected',
    };
  }
  const db = mongoose.connection.db;
  if (!db) {
    return {
      ready: false,
      required: true,
      reason: 'no database handle is available',
    };
  }
  return inspectActivityIndexes(db);
};

export const activityIndexRequirementMessage = (
  readiness: ActivityIndexReadiness,
): string =>
  [
    'ACTIVITY_EVENTS_ENABLED=true but the required MongoDB activity indexes are not ready.',
    `Reason: ${readiness.reason}.`,
    'Create and verify the documented activity indexes before starting the API with activity events enabled.',
    'The API stays fully operational with ACTIVITY_EVENTS_ENABLED=false.',
  ].join(' ');
