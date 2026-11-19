import { Router } from 'express';
import { getPublicPaymentMethods } from '../config/payment.js';
import { getPaymentIndexReadiness } from '../config/payment-index.js';

export const paymentRouter: Router = Router();

/**
 * Public payment options for checkout. Disabled manual providers are returned
 * as `enabled: false` without a receiving number; only enabled providers expose
 * the configured account. If manual payments are enabled but the payment index
 * is not ready, every manual method is hidden/disabled and COD remains
 * available.
 */
paymentRouter.get('/methods', async (_req, res) => {
  const readiness = await getPaymentIndexReadiness();
  const manualPaymentsUnavailable = readiness.required && !readiness.ready;
  res.status(200).json({
    methods: getPublicPaymentMethods({ manualAvailable: !manualPaymentsUnavailable }),
    manualPaymentsUnavailable,
  });
});
