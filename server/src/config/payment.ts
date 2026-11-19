import { env } from './env.js';
import {
  isManualPaymentMethod,
  MANUAL_PAYMENT_METHODS,
  normalizeReceivingAccount,
  type ManualPaymentMethod,
} from '../utils/payment.js';
import type { PaymentMethod, PaymentProviderId } from '../models/order.model.js';

export interface PublicPaymentMethod {
  method: PaymentMethod;
  provider: PaymentProviderId;
  label: string;
  enabled: boolean;
  /** Only populated for enabled manual methods; null for COD/disabled. */
  receivingNumber: string | null;
  /** Provider-specific, owner-safe instructions. Never includes PIN/OTP. */
  instructions: string[];
  requiresProof: boolean;
  trxIdMinLength?: number;
  trxIdMaxLength?: number;
}

export interface ManualPaymentConfig {
  method: ManualPaymentMethod;
  enabled: boolean;
  receivingNumber: string | null;
  instructions: string[];
}

const DEFAULT_INSTRUCTIONS: Record<ManualPaymentMethod, string[]> = {
  bkash: [
    'Send the exact payable total to the bKash receiving number shown above.',
    'Use only the transfer type approved for this receiving account. If you are unsure, contact us before sending.',
    'Enter the sender wallet number and the transaction ID from your bKash confirmation message.',
    'Never share your wallet PIN, OTP or password with anyone.',
  ],
  nagad: [
    'Send the exact payable total to the Nagad receiving number shown above.',
    'Use only the transfer type approved for this receiving account. If you are unsure, contact us before sending.',
    'Enter the sender wallet number and the transaction ID from your Nagad confirmation message.',
    'Never share your wallet PIN, OTP or password with anyone.',
  ],
  rocket: [
    'Send the exact payable total to the Rocket receiving account shown above.',
    'Rocket account numbers may include a 12th check digit. Confirm the full number before sending.',
    'Use only the transfer type approved for this receiving account. If you are unsure, contact us before sending.',
    'Enter the sender wallet number and the transaction ID from your Rocket confirmation message.',
    'Never share your wallet PIN, OTP or password with anyone.',
  ],
};

const readRawConfig = (
  method: ManualPaymentMethod,
): { enabled: boolean; number: string; instructions: string } => {
  switch (method) {
    case 'bkash':
      return {
        enabled: env.BKASH_PAYMENT_ENABLED,
        number: env.BKASH_PAYMENT_NUMBER,
        instructions: env.BKASH_PAYMENT_INSTRUCTIONS,
      };
    case 'nagad':
      return {
        enabled: env.NAGAD_PAYMENT_ENABLED,
        number: env.NAGAD_PAYMENT_NUMBER,
        instructions: env.NAGAD_PAYMENT_INSTRUCTIONS,
      };
    case 'rocket':
      return {
        enabled: env.ROCKET_PAYMENT_ENABLED,
        number: env.ROCKET_PAYMENT_NUMBER,
        instructions: env.ROCKET_PAYMENT_INSTRUCTIONS,
      };
  }
};

const parseInstructions = (method: ManualPaymentMethod, raw: string): string[] => {
  if (!raw) {
    return DEFAULT_INSTRUCTIONS[method];
  }
  const parsed = raw
    .split('|')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_INSTRUCTIONS[method];
};

export const getManualPaymentConfig = (method: ManualPaymentMethod): ManualPaymentConfig => {
  const raw = readRawConfig(method);
  const receivingNumber = normalizeReceivingAccount(method, raw.number);
  return {
    method,
    // A provider whose receiving account is invalid/missing is exposed as
    // disabled rather than leaking a half-configured collection path.
    enabled: raw.enabled && receivingNumber !== null,
    receivingNumber,
    instructions: parseInstructions(method, raw.instructions),
  };
};

const COD_INSTRUCTIONS = [
  'Pay in cash to the delivery person when your order arrives.',
  'No advance payment is needed.',
];

export const isAnyManualProviderEnabled = (): boolean =>
  MANUAL_PAYMENT_METHODS.some((method) => getManualPaymentConfig(method).enabled);

export interface PublicPaymentOptions {
  /**
   * When false, manual methods are advertised as unavailable and no receiving
   * number or provider-specific instructions are returned. COD is unaffected.
   */
  manualAvailable?: boolean;
}

export const getPublicPaymentMethods = (
  options: PublicPaymentOptions = {},
): PublicPaymentMethod[] => {
  const manualAvailable = options.manualAvailable !== false;
  const cod: PublicPaymentMethod = {
    method: 'cod',
    provider: 'cod',
    label: 'Cash on Delivery',
    enabled: true,
    receivingNumber: null,
    instructions: COD_INSTRUCTIONS,
    requiresProof: false,
  };

  const manual = MANUAL_PAYMENT_METHODS.map((method): PublicPaymentMethod => {
    const config = getManualPaymentConfig(method);
    return {
      method,
      provider: 'manual',
      label: method === 'bkash' ? 'bKash' : method === 'nagad' ? 'Nagad' : 'Rocket',
      enabled: config.enabled && manualAvailable,
      receivingNumber: config.enabled && manualAvailable ? config.receivingNumber : null,
      instructions: config.enabled && manualAvailable ? config.instructions : [],
      requiresProof: true,
      trxIdMinLength: env.MFS_TRX_ID_MIN_LENGTH,
      trxIdMaxLength: env.MFS_TRX_ID_MAX_LENGTH,
    };
  });

  return [cod, ...manual];
};

export const isManualMethod = isManualPaymentMethod;
