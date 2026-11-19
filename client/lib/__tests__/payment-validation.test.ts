import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSenderNumber,
  normalizeTrxId,
  parseBdtToPoisha,
  validateManualPayment,
  validateRefundEvidence,
} from '../validation/payment.ts';

describe('manual payment inline validation', () => {
  it('normalizes +880 and 880 sender numbers', () => {
    assert.equal(normalizeSenderNumber('+880 1712-345678'), '01712345678');
    assert.equal(normalizeSenderNumber('8801712345678'), '01712345678');
    assert.equal(normalizeSenderNumber('01712345678'), '01712345678');
  });

  it('normalizes transaction ids and enforces configured bounds', () => {
    assert.equal(normalizeTrxId(' ab 12cd '), 'AB12CD');
    assert.deepEqual(validateManualPayment({ senderNumber: '01712345678', trxId: 'AB12CD' }), {});
    assert.equal(
      validateManualPayment({ senderNumber: '01712345678', trxId: 'AB-12-CD' }).trxId?.startsWith(
        'Enter a valid transaction ID',
      ),
      true,
    );
    assert.equal(
      validateManualPayment({ senderNumber: '01712345678', trxId: 'ABC' }).trxId?.includes('6'),
      true,
    );
    assert.equal(
      validateManualPayment(
        { senderNumber: '01712345678', trxId: 'AB12CD' },
        { min: 8, max: 20 },
      ).trxId?.startsWith('Enter a valid transaction ID'),
      true,
    );
  });

  it('rejects invalid senders', () => {
    for (const senderNumber of ['', '123', '0171234567', '02712345678']) {
      assert.equal(
        validateManualPayment({ senderNumber, trxId: 'AB12CD' }).senderNumber,
        'Enter a valid Bangladeshi mobile number.',
      );
    }
  });

  it('requires complete refund evidence matching the order', () => {
    const valid = {
      refundReference: 'REF-12345',
      refundAmountBdt: '100.00',
      refundRecipient: '01712345678',
      confirmed: true,
    };
    assert.deepEqual(validateRefundEvidence(valid, 10000, '01712345678'), {});
    assert.equal(parseBdtToPoisha('100.00'), 10000);
    assert.equal(parseBdtToPoisha('0.01'), 1);
    assert.equal(parseBdtToPoisha('1.234'), null);
    assert.equal(parseBdtToPoisha('abc'), null);

    const missing = validateRefundEvidence(
      { refundReference: '', refundAmountBdt: '', refundRecipient: '', confirmed: false },
      10000,
      '01712345678',
    );
    assert.ok(missing.refundReference);
    assert.ok(missing.refundAmountBdt);
    assert.ok(missing.refundRecipient);
    assert.ok(missing.confirmed);

    assert.ok(
      validateRefundEvidence({ ...valid, refundReference: 'x' }, 10000, '01712345678')
        .refundReference,
    );
    assert.ok(
      validateRefundEvidence({ ...valid, refundAmountBdt: '99.99' }, 10000, '01712345678')
        .refundAmountBdt,
    );
    assert.ok(
      validateRefundEvidence({ ...valid, refundRecipient: '01799999999' }, 10000, '01712345678')
        .refundRecipient,
    );
  });
});
