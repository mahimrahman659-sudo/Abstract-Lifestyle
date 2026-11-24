import mongoose from 'mongoose';
import type { RequestHandler } from 'express';
import { getDeploymentCapabilities } from '../config/db.js';
import { getPaymentIndexReadiness } from '../config/payment-index.js';
import { getActivityIndexReadiness } from '../config/activity-index.js';

/** True only when the default connection is open AND MongoDB answers a ping. */
const isDatabaseReady = async (): Promise<boolean> => {
  if (mongoose.connection.readyState !== 1) {
    return false;
  }
  try {
    await mongoose.connection.db?.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
};

export const getHealth: RequestHandler = async (_req, res) => {
  const databaseReady = await isDatabaseReady();
  // Readiness includes the transaction capability: checkout/cancel cannot work
  // without it, and the API refuses to start when it is missing.
  const transactions = databaseReady && (getDeploymentCapabilities()?.transactions ?? false);
  const paymentIndex = await getPaymentIndexReadiness();
  const paymentIndexReady = paymentIndex.ready;
  // Activity indexes are only required while the flag is on; readiness flips
  // to 503 if they are dropped after startup (R-1 runtime signal).
  const activityIndex = await getActivityIndexReadiness();
  const activityIndexReady = activityIndex.ready;
  const ok = databaseReady && transactions && paymentIndexReady && activityIndexReady;
  // Status only — never expose error details or connection information.
  res.status(ok ? 200 : 503).json({
    ok,
    transactions,
    ...(paymentIndex.required ? { paymentIndex: paymentIndexReady } : {}),
    ...(activityIndex.required ? { activityIndex: activityIndexReady } : {}),
  });
};
