import type { OrderDocument, PaymentMethod, PaymentStatus } from '../models/order.model.js';

/**
 * Pluggable payment layer. Only Cash-on-Delivery is implemented in the MVP;
 * future gateways plug in here without touching order logic.
 */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  /** Payment status recorded when an order is created. */
  initialPaymentStatus(): PaymentStatus;
  /** Hook for future gateways (e.g. creating a payment session). */
  onOrderPlaced(order: OrderDocument): Promise<void>;
}

class CodPaymentProvider implements PaymentProvider {
  readonly method = 'cod' as const;

  initialPaymentStatus(): PaymentStatus {
    return 'unpaid';
  }

  async onOrderPlaced(_order: OrderDocument): Promise<void> {
    // Cash on delivery: nothing to collect upfront; 'paid' is set on delivery.
  }
}

const providers: Record<PaymentMethod, PaymentProvider> = {
  cod: new CodPaymentProvider(),
};

export const getPaymentProvider = (method: PaymentMethod): PaymentProvider => providers[method];
