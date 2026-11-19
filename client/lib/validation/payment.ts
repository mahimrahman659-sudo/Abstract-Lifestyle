export interface ManualPaymentValues {
  senderNumber: string;
  trxId: string;
}

export interface ManualPaymentErrors {
  senderNumber?: string;
  trxId?: string;
}

const BD_MOBILE = /^01[3-9]\d{8}$/;
const TRX_ID = /^[A-Z0-9]+$/;

export const normalizeSenderNumber = (value: string): string => {
  const compact = value.replace(/[\s\-()]/g, '');
  if (compact.startsWith('+880')) {
    return `0${compact.slice(4)}`;
  }
  if (compact.startsWith('880')) {
    return `0${compact.slice(3)}`;
  }
  return compact;
};

export const normalizeTrxId = (value: string): string =>
  value.replace(/\s+/g, '').toUpperCase();

export const validateManualPayment = (
  values: ManualPaymentValues,
  bounds: { min: number; max: number } = { min: 6, max: 32 },
): ManualPaymentErrors => {
  const errors: ManualPaymentErrors = {};
  if (!BD_MOBILE.test(normalizeSenderNumber(values.senderNumber))) {
    errors.senderNumber = 'Enter a valid Bangladeshi mobile number.';
  }
  const trxId = normalizeTrxId(values.trxId);
  if (
    trxId.length < bounds.min ||
    trxId.length > bounds.max ||
    !TRX_ID.test(trxId)
  ) {
    errors.trxId = `Enter a valid transaction ID (${bounds.min}–${bounds.max} letters or digits).`;
  }
  return errors;
};

export interface RefundEvidenceValues {
  refundReference: string;
  refundAmountBdt: string;
  refundRecipient: string;
  confirmed: boolean;
}

export interface RefundEvidenceErrors {
  refundReference?: string;
  refundAmountBdt?: string;
  refundRecipient?: string;
  confirmed?: string;
}

const REFUND_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,99}$/;

export const parseBdtToPoisha = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const poisha = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  return Number.isSafeInteger(poisha) ? poisha : null;
};

export const validateRefundEvidence = (
  values: RefundEvidenceValues,
  expectedTotal: number,
  expectedRecipient: string | null,
): RefundEvidenceErrors => {
  const errors: RefundEvidenceErrors = {};
  if (!REFUND_REFERENCE.test(values.refundReference.trim())) {
    errors.refundReference =
      'Enter the provider refund reference (4-100 letters, digits, dots, underscores or hyphens).';
  }
  const poisha = parseBdtToPoisha(values.refundAmountBdt);
  if (poisha === null) {
    errors.refundAmountBdt = 'Enter a valid BDT amount with up to 2 decimals.';
  } else if (poisha !== expectedTotal) {
    errors.refundAmountBdt = `The refund amount must equal the order total (৳${(expectedTotal / 100).toFixed(2)}).`;
  }
  const recipient = normalizeSenderNumber(values.refundRecipient);
  if (!BD_MOBILE.test(recipient)) {
    errors.refundRecipient = 'Enter the customer receiving wallet number.';
  } else if (!expectedRecipient || recipient !== expectedRecipient) {
    errors.refundRecipient = 'The recipient must match the account that paid for this order.';
  }
  if (!values.confirmed) {
    errors.confirmed = 'Confirm you checked the actual provider refund record.';
  }
  return errors;
};
