import mongoose from 'mongoose';
import type { RequestHandler } from 'express';

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
  const ok = await isDatabaseReady();
  // Status only — never expose error details.
  res.status(ok ? 200 : 503).json({ ok });
};
