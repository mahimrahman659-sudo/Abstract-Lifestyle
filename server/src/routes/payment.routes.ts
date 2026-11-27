import { Router } from 'express';
import { getPublicPaymentMethods } from '../config/payment.js';

export const paymentRouter: Router = Router();

/**
 * Public payment options for checkout. Disabled manual providers are returned
 * as `enabled: false` without a receiving number; only enabled providers expose
 * the configured account.
 */
paymentRouter.get('/methods', (_req, res) => {
  res.status(200).json({ methods: getPublicPaymentMethods() });
});
