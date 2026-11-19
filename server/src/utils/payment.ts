import type { PaymentMethod, PaymentStatus } from '../models/order.model.js';
import { normalizeBdMobile } from './phone.js';

/** Manual mobile-financial-service (MFS) methods supported in Phase 2. */
export const MANUAL_PAYMENT_METHODS = ['bkash', 'nagad', 'rocket'] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cod: 'Cash on Delivery',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
};

export const isManualPaymentMethod = (method: PaymentMethod): method is ManualPaymentMethod =>
  (MANUAL_PAYMENT_METHODS as readonly string[]).includes(method);

/**
 * Normalizes a configured receiving account.
 *
 * bKash and Nagad accounts are 11-digit Bangladeshi mobile numbers. Rocket
 * account identifiers may carry a 12th check digit, so both the 11-digit
 * mobile form and the 12-digit account form are accepted for Rocket only.
 */
export const normalizeReceivingAccount = (
  method: PaymentMethod,
  raw: string,
): string | null => {
  if (!isManualPaymentMethod(method)) {
    return null;
  }
  let compact = raw.replace(/[\s\-()]/g, '');
  if (compact.startsWith('+880')) {
    compact = `0${compact.slice(4)}`;
  } else if (compact.startsWith('880')) {
    compact = `0${compact.slice(3)}`;
  }
  if (method === 'rocket') {
    return /^01[3-9]\d{8}\d?$/.test(compact) ? compact : null;
  }
  return /^01[3-9]\d{8}$/.test(compact) ? compact : null;
};

/** Sender wallet numbers are always 11-digit Bangladeshi mobile numbers. */
export const normalizeSenderNumber = (raw: string): string | null => normalizeBdMobile(raw);

/**
 * TrxID formats differ between providers and are not formally documented.
 * Normalization is deliberately conservative: trim, drop whitespace and
 * uppercase. Length and character constraints are configurable in env.
 */
export const normalizeTrxId = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

export const TRX_ID_CHARACTERS = /^[A-Z0-9]+$/;

export const isValidTrxId = (normalized: string, minLength: number, maxLength: number): boolean =>
  TRX_ID_CHARACTERS.test(normalized) &&
  normalized.length >= minLength &&
  normalized.length <= maxLength;

export const isAwaitingPayment = (status: PaymentStatus): boolean =>
  status === 'awaiting_payment' || status === 'rejected';

/**
 * Returns the payment status a cancellation should record, or null when the
 * order must not be cancelled automatically.
 *
 * COD cancellation is unchanged (payment status is left untouched). A manual
 * payment under verification cannot be cancelled without reconciliation. A
 * confirmed prepaid order moves to an explicit `refund_pending` state — it is
 * never treated as refunded just because the order was cancelled.
 */
export const paymentStatusAfterCancellation = (
  method: PaymentMethod,
  status: PaymentStatus,
): PaymentStatus | null => {
  if (status === 'pending_verification') {
    return null;
  }
  if (method === 'cod') {
    return status;
  }
  switch (status) {
    case 'awaiting_payment':
    case 'rejected':
      return 'cancelled';
    case 'paid':
      return 'refund_pending';
    default:
      return status;
  }
};

export const canSubmitPaymentClaim = (status: PaymentStatus): boolean =>
  status === 'awaiting_payment' || status === 'rejected';

/** Matches legacy unpaid orders whose stored document predates paymentStatus. */
export const paymentStatusFilter = (status: PaymentStatus): Record<string, unknown> =>
  status === 'unpaid'
    ? { $or: [{ paymentStatus: 'unpaid' }, { paymentStatus: { $exists: false } }] }
    : { paymentStatus: status };

export const isManualPaymentStatus = (
  status: PaymentStatus,
): status is 'awaiting_payment' | 'pending_verification' | 'rejected' | 'refund_pending' | 'refunded' =>
  status === 'awaiting_payment' ||
  status === 'pending_verification' ||
  status === 'rejected' ||
  status === 'refund_pending' ||
  status === 'refunded';
