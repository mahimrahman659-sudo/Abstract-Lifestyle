import './setup-env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { getManualPaymentConfig, getPublicPaymentMethods } from '../src/config/payment.js';
import {
  normalizeReceivingAccount,
  normalizeSenderNumber,
  normalizeTrxId,
  paymentStatusAfterCancellation,
  isValidTrxId,
  canSubmitPaymentClaim,
} from '../src/utils/payment.js';
import {
  createOrderSchema,
  manualPaymentSubmissionSchema,
} from '../src/schemas/order.schema.js';
import { adminPaymentReviewSchema } from '../src/schemas/admin.schema.js';
import {
  evaluatePaymentTrxIdIndex,
  inspectPaymentTrxIdIndex,
  PAYMENT_TRXID_INDEX_KEY,
  PAYMENT_TRXID_INDEX_NAME,
  PAYMENT_TRXID_INDEX_PARTIAL,
} from '../src/config/payment-index.js';

const setManualConfig = (
  method: 'BKASH' | 'NAGAD' | 'ROCKET',
  enabled: boolean,
  number: string,
): void => {
  const mutable = env as unknown as Record<string, boolean | string>;
  mutable[`${method}_PAYMENT_ENABLED`] = enabled;
  mutable[`${method}_PAYMENT_NUMBER`] = number;
};

describe('Phase 2 — payment validation and configuration (unit)', () => {
  it('normalizes Bangladeshi sender numbers and TrxIDs conservatively', () => {
    assert.equal(normalizeSenderNumber('+880 1712-345678'), '01712345678');
    assert.equal(normalizeSenderNumber('8801712345678'), '01712345678');
    assert.equal(normalizeSenderNumber('01712345678'), '01712345678');
    assert.equal(normalizeSenderNumber('0171234567'), null);

    assert.equal(normalizeTrxId('  ab12cd  '), 'AB12CD');
    assert.equal(normalizeTrxId('ab 12\tcd'), 'AB12CD');
    assert.equal(normalizeTrxId('AB-12-CD'), 'AB-12-CD');
    assert.equal(isValidTrxId('AB12CD', 6, 32), true);
    assert.equal(isValidTrxId('AB-12-CD', 6, 32), false);
    assert.equal(isValidTrxId('ABC', 6, 32), false);
    assert.equal(isValidTrxId('A'.repeat(33), 6, 32), false);
  });

  it('accepts Rocket 12-digit accounts without forcing every provider to 12 digits', () => {
    assert.equal(normalizeReceivingAccount('bkash', '01712345678'), '01712345678');
    assert.equal(normalizeReceivingAccount('nagad', '+8801712345678'), '01712345678');
    assert.equal(normalizeReceivingAccount('bkash', '017123456789'), null);
    assert.equal(normalizeReceivingAccount('rocket', '01712345678'), '01712345678');
    assert.equal(normalizeReceivingAccount('rocket', '017123456789'), '017123456789');
    assert.equal(normalizeReceivingAccount('rocket', '0171234567890'), null);
    assert.equal(normalizeReceivingAccount('cod', '01712345678'), null);
  });

  it('computes cancellation payment outcomes without auto-refunding or silently cancelling claims', () => {
    assert.equal(paymentStatusAfterCancellation('cod', 'unpaid'), 'unpaid');
    assert.equal(paymentStatusAfterCancellation('cod', 'paid'), 'paid');
    assert.equal(paymentStatusAfterCancellation('bkash', 'awaiting_payment'), 'cancelled');
    assert.equal(paymentStatusAfterCancellation('nagad', 'rejected'), 'cancelled');
    assert.equal(paymentStatusAfterCancellation('rocket', 'pending_verification'), null);
    assert.equal(paymentStatusAfterCancellation('bkash', 'paid'), 'refund_pending');
    assert.equal(paymentStatusAfterCancellation('bkash', 'refund_pending'), 'refund_pending');
    assert.equal(paymentStatusAfterCancellation('bkash', 'refunded'), 'refunded');

    assert.equal(canSubmitPaymentClaim('awaiting_payment'), true);
    assert.equal(canSubmitPaymentClaim('rejected'), true);
    assert.equal(canSubmitPaymentClaim('pending_verification'), false);
    assert.equal(canSubmitPaymentClaim('paid'), false);
  });

  it('keeps every manual provider disabled by default', () => {
    setManualConfig('BKASH', false, '');
    setManualConfig('NAGAD', false, '');
    setManualConfig('ROCKET', false, '');
    const methods = getPublicPaymentMethods();
    assert.equal(methods.length, 4);
    assert.equal(methods[0]?.method, 'cod');
    assert.equal(methods[0]?.enabled, true);
    for (const method of methods.slice(1)) {
      assert.equal(method.enabled, false);
      assert.equal(method.receivingNumber, null);
      assert.deepEqual(method.instructions, []);
      assert.equal(method.provider, 'manual');
    }
  });

  it('exposes only enabled, valid receiving accounts to the storefront', () => {
    setManualConfig('BKASH', true, '+880 1712-345678');
    setManualConfig('NAGAD', true, '');
    setManualConfig('ROCKET', true, '017123456789');
    try {
      const methods = getPublicPaymentMethods();
      const bkash = methods.find((method) => method.method === 'bkash');
      const nagad = methods.find((method) => method.method === 'nagad');
      const rocket = methods.find((method) => method.method === 'rocket');
      assert.equal(bkash?.enabled, true);
      assert.equal(bkash?.receivingNumber, '01712345678');
      assert.equal(nagad?.enabled, false, 'enabled flag without a valid number is not usable');
      assert.equal(nagad?.receivingNumber, null);
      assert.deepEqual(nagad?.instructions, [], 'disabled provider instructions are not public');
      assert.equal(rocket?.enabled, true);
      assert.equal(rocket?.receivingNumber, '017123456789');
      assert.equal(getManualPaymentConfig('bkash').instructions.length > 0, true);
      assert.equal(
        getManualPaymentConfig('bkash').instructions.join(' ').includes('PIN'),
        true,
        'instructions warn against sharing PIN/OTP',
      );
    } finally {
      setManualConfig('BKASH', false, '');
      setManualConfig('NAGAD', false, '');
      setManualConfig('ROCKET', false, '');
    }
  });

  it('hides manual details when public readiness says manual payments are unavailable', () => {
    setManualConfig('BKASH', true, '01711111111');
    try {
      const methods = getPublicPaymentMethods({ manualAvailable: false });
      const cod = methods.find((method) => method.method === 'cod');
      const bkash = methods.find((method) => method.method === 'bkash');
      assert.equal(cod?.enabled, true);
      assert.equal(bkash?.enabled, false);
      assert.equal(bkash?.receivingNumber, null);
      assert.deepEqual(bkash?.instructions, []);
    } finally {
      setManualConfig('BKASH', false, '');
    }
  });

  it('validates the manual submission schema and normalizes values', () => {
    const parsed = manualPaymentSubmissionSchema.parse({
      senderNumber: '+8801712345678',
      trxId: '  ab12cd  ',
    });
    assert.equal(parsed.senderNumber, '01712345678');
    assert.equal(parsed.trxId, 'AB12CD');

    assert.throws(() => manualPaymentSubmissionSchema.parse({ senderNumber: '123', trxId: 'AB12CD' }));
    assert.throws(() => manualPaymentSubmissionSchema.parse({ senderNumber: '01712345678', trxId: 'ab-12' }));
    assert.throws(() => manualPaymentSubmissionSchema.parse({ senderNumber: '01712345678', trxId: 'AB' }));
  });

  it('accepts manual order methods and rejects unknown methods', () => {
    for (const method of ['cod', 'bkash', 'nagad', 'rocket'] as const) {
      const parsed = createOrderSchema.parse({
        checkoutId: '11111111-1111-4111-8111-111111111111',
        paymentMethod: method,
        shippingAddress: {
          fullName: 'Customer',
          phone: '01712345678',
          line1: 'Dhaka',
        },
      });
      assert.equal(parsed.paymentMethod, method);
    }
    assert.throws(() =>
      createOrderSchema.parse({
        checkoutId: '11111111-1111-4111-8111-111111111111',
        paymentMethod: 'card',
        shippingAddress: { fullName: 'Customer', phone: '01712345678', line1: 'Dhaka' },
      }),
    );
  });

  it('evaluates the required payment TrxID index metadata exactly', () => {
    const correct = {
      name: PAYMENT_TRXID_INDEX_NAME,
      key: PAYMENT_TRXID_INDEX_KEY,
      unique: true,
      partialFilterExpression: PAYMENT_TRXID_INDEX_PARTIAL,
    };
    assert.equal(evaluatePaymentTrxIdIndex([correct], false).ready, true);
    assert.equal(evaluatePaymentTrxIdIndex([correct], true).ready, true);
    assert.equal(evaluatePaymentTrxIdIndex([], true).ready, false);
    assert.equal(evaluatePaymentTrxIdIndex([], false).ready, true);
    assert.equal(evaluatePaymentTrxIdIndex([{ ...correct, name: 'other' }], true).ready, false);
    assert.equal(
      evaluatePaymentTrxIdIndex([{ ...correct, key: { 'payment.claims.trxId': 1 } }], true).ready,
      false,
    );
    assert.equal(evaluatePaymentTrxIdIndex([{ ...correct, unique: false }], true).ready, false);
    assert.equal(
      evaluatePaymentTrxIdIndex(
        [{ ...correct, partialFilterExpression: { 'payment.claims.trxIdNormalized': { $exists: true } } }],
        true,
      ).ready,
      false,
    );
    assert.equal(evaluatePaymentTrxIdIndex([{ ...correct, sparse: true }], true).ready, false);
    assert.equal(evaluatePaymentTrxIdIndex([{ ...correct, collation: { locale: 'en' } }], true).ready, false);
    assert.equal(evaluatePaymentTrxIdIndex([{ ...correct, hidden: true }], true).ready, false);
    assert.equal(evaluatePaymentTrxIdIndex([{ ...correct, expireAfterSeconds: 60 }], true).ready, false);
  });

  it('treats an index-inspection failure as not ready when manual payments are enabled', async () => {
    setManualConfig('BKASH', true, '01711111111');
    try {
      const fakeDb = {
        collection: () => ({
          indexes: async () => {
            throw new Error('listIndexes failed');
          },
        }),
      };
      const readiness = await inspectPaymentTrxIdIndex(
        fakeDb as unknown as Parameters<typeof inspectPaymentTrxIdIndex>[0],
      );
      assert.equal(readiness.ready, false);
      assert.equal(readiness.required, true);
    } finally {
      setManualConfig('BKASH', false, '');
    }
  });

  it('requires a rejection reason and a claim id for admin decisions', () => {
    const claimId = '507f1f77bcf86cd799439011';
    assert.equal(
      adminPaymentReviewSchema.safeParse({ claimId, decision: 'paid' }).success,
      true,
    );
    assert.equal(
      adminPaymentReviewSchema.safeParse({ claimId, decision: 'rejected' }).success,
      false,
    );
    assert.equal(
      adminPaymentReviewSchema.safeParse({
        claimId,
        decision: 'rejected',
        rejectionReason: 'Transaction not found',
      }).success,
      true,
    );
    assert.equal(
      adminPaymentReviewSchema.safeParse({ claimId: 'bad', decision: 'paid' }).success,
      false,
    );
  });
});
