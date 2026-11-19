import mongoose from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { isAnyManualProviderEnabled } from './payment.js';

export const PAYMENT_TRXID_INDEX_NAME = 'payment_trxid_unique';
export const PAYMENT_TRXID_INDEX_KEY = { 'payment.claims.trxIdNormalized': 1 } as const;
export const PAYMENT_TRXID_INDEX_PARTIAL = {
  'payment.claims.trxIdNormalized': { $type: 'string' },
} as const;

export interface IndexInfo {
  name?: unknown;
  key?: unknown;
  unique?: unknown;
  partialFilterExpression?: unknown;
  sparse?: unknown;
  collation?: unknown;
  hidden?: unknown;
  expireAfterSeconds?: unknown;
}

export interface PaymentIndexReadiness {
  ready: boolean;
  required: boolean;
  reason: string;
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const evaluatePaymentTrxIdIndex = (
  indexes: readonly IndexInfo[],
  required: boolean,
): PaymentIndexReadiness => {
  if (!required) {
    return {
      ready: true,
      required: false,
      reason: 'all manual payment providers are disabled',
    };
  }

  const index = indexes.find((item) => item.name === PAYMENT_TRXID_INDEX_NAME);
  if (!index) {
    return {
      ready: false,
      required: true,
      reason: `the required index "${PAYMENT_TRXID_INDEX_NAME}" is missing`,
    };
  }
  if (stableStringify(index.key) !== stableStringify(PAYMENT_TRXID_INDEX_KEY)) {
    return {
      ready: false,
      required: true,
      reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" has the wrong key pattern`,
    };
  }
  if (index.unique !== true) {
    return {
      ready: false,
      required: true,
      reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" is not unique`,
    };
  }
  if (
    stableStringify(index.partialFilterExpression) !==
    stableStringify(PAYMENT_TRXID_INDEX_PARTIAL)
  ) {
    return {
      ready: false,
      required: true,
      reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" has the wrong partial filter`,
    };
  }
  if (index.sparse === true) {
    return {
      ready: false,
      required: true,
      reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" is sparse`,
    };
  }
  if (index.collation !== undefined && index.collation !== null) {
    return {
      ready: false,
      required: true,
      reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" has a collation`,
    };
  }
  if (index.hidden === true) {
    return {
      ready: false,
      required: true,
      reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" is hidden`,
    };
  }
  if (index.expireAfterSeconds !== undefined && index.expireAfterSeconds !== null) {
    return {
      ready: false,
      required: true,
      reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" has an expiry option`,
    };
  }

  return {
    ready: true,
    required: true,
    reason: `the index "${PAYMENT_TRXID_INDEX_NAME}" is present and correct`,
  };
};

type DatabaseHandle = NonNullable<typeof mongoose.connection.db>;

export const inspectPaymentTrxIdIndex = async (
  db: DatabaseHandle,
): Promise<PaymentIndexReadiness> => {
  const required = isAnyManualProviderEnabled();
  if (!required) {
    return evaluatePaymentTrxIdIndex([], false);
  }
  try {
    const indexes = (await db.collection('orders').indexes()) as unknown as IndexInfo[];
    return evaluatePaymentTrxIdIndex(indexes, true);
  } catch {
    return {
      ready: false,
      required: true,
      reason: `the index metadata could not be inspected`,
    };
  }
};

export const getPaymentIndexReadiness = async (): Promise<PaymentIndexReadiness> => {
  const required = isAnyManualProviderEnabled();
  if (!required) {
    return { ready: true, required: false, reason: 'all manual payment providers are disabled' };
  }
  if (mongoose.connection.readyState !== 1) {
    return { ready: false, required: true, reason: 'the database is not connected' };
  }
  const db = mongoose.connection.db;
  if (!db) {
    return { ready: false, required: true, reason: 'no database handle is available' };
  }
  return inspectPaymentTrxIdIndex(db);
};

export const paymentIndexRequirementMessage = (readiness: PaymentIndexReadiness): string =>
  [
    'Manual payment providers are enabled but the required MongoDB payment index is not ready.',
    `Reason: ${readiness.reason}.`,
    'Create and verify the documented index before starting the API with manual payments enabled.',
    'COD remains available when every manual provider is disabled.',
  ].join(' ');

export const assertPaymentIndexReadyForManualOperations = async (): Promise<void> => {
  const readiness = await getPaymentIndexReadiness();
  if (readiness.required && !readiness.ready) {
    console.error(`Manual payment readiness check failed: ${readiness.reason}`);
    throw new AppError(
      503,
      'PAYMENT_INDEX_UNAVAILABLE',
      'Manual payments are temporarily unavailable. Please try again later.',
    );
  }
};
