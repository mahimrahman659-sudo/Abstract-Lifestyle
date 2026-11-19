import { getManualPaymentConfig } from '../config/payment.js';
import { AppError } from '../middleware/error-handler.js';
import type {
  OrderDocument,
  PaymentMethod,
  PaymentProviderId,
  PaymentStatus,
} from '../models/order.model.js';

/**
 * Pluggable payment layer. `cod` and the manual MFS provider are implemented;
 * future automated gateways plug in here without touching order logic.
 */
export interface PaymentProvider {
  readonly provider: PaymentProviderId;
  readonly method: PaymentMethod;
  /** Payment status recorded when an order is created. */
  initialPaymentStatus(): PaymentStatus;
  /** Whether new orders may use this method right now. */
  isEnabled(): boolean;
  /** Hook for future gateways (e.g. creating a payment session). */
  onOrderPlaced(order: OrderDocument): Promise<void>;
}

class CodPaymentProvider implements PaymentProvider {
  readonly provider = 'cod' as const;
  readonly method = 'cod' as const;

  initialPaymentStatus(): PaymentStatus {
    return 'unpaid';
  }

  isEnabled(): boolean {
    return true;
  }

  async onOrderPlaced(_order: OrderDocument): Promise<void> {
    // Cash on delivery: nothing to collect upfront; 'paid' is set on delivery.
  }
}

class ManualMfsPaymentProvider implements PaymentProvider {
  readonly provider = 'manual' as const;
  readonly method: 'bkash' | 'nagad' | 'rocket';

  constructor(method: 'bkash' | 'nagad' | 'rocket') {
    this.method = method;
  }

  initialPaymentStatus(): PaymentStatus {
    return 'awaiting_payment';
  }

  isEnabled(): boolean {
    return getManualPaymentConfig(this.method).enabled;
  }

  async onOrderPlaced(_order: OrderDocument): Promise<void> {
    // The customer transfers externally and submits the proof afterwards.
  }
}

const providers: Record<PaymentMethod, PaymentProvider> = {
  cod: new CodPaymentProvider(),
  bkash: new ManualMfsPaymentProvider('bkash'),
  nagad: new ManualMfsPaymentProvider('nagad'),
  rocket: new ManualMfsPaymentProvider('rocket'),
};

/**
 * Resolves a provider for order creation. Disabled/misconfigured manual
 * providers are rejected before any cart claim or stock decrement.
 */
export const getPaymentProvider = (method: PaymentMethod): PaymentProvider => {
  const provider = providers[method];
  if (!provider) {
    throw new AppError(400, 'PAYMENT_METHOD_UNAVAILABLE', 'Unsupported payment method');
  }
  if (!provider.isEnabled()) {
    throw new AppError(
      409,
      'PAYMENT_METHOD_UNAVAILABLE',
      'This payment method is not available right now. Choose Cash on Delivery or try again later.',
    );
  }
  return provider;
};
