import mongoose from 'mongoose';
import {
  assertSafeTestTarget,
  requireTestDatabaseConfig,
  UnsafeTestDatabaseError,
} from '../guards/test-database.js';

let approvedDatabase: typeof mongoose.connection.db | null = null;

/** The target the driver actually resolved — the authoritative check input. */
export const resolveTestTarget = (): { databaseName: string; host: string } => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Not connected to a MongoDB test database.');
  }
  return { databaseName: db.databaseName, host: mongoose.connection.host ?? '' };
};

/**
 * Connects to the designated test database and refuses to continue unless the
 * driver-resolved target is safe (suffix `_test`, not production-like, loopback
 * only). On refusal the connection is closed again.
 */
export const connectTestDatabase = async (): Promise<void> => {
  approvedDatabase = null;
  const { uri, target } = requireTestDatabaseConfig();
  try {
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
    assertSafeTestTarget(resolveTestTarget()); // authoritative, driver-resolved
    if (mongoose.connection.db?.databaseName !== target.databaseName) {
      throw new UnsafeTestDatabaseError('Resolved database differs from the designated test database. No records were deleted.');
    }
    approvedDatabase = mongoose.connection.db;
  } catch {
    await mongoose.disconnect().catch(() => undefined);
    throw new UnsafeTestDatabaseError('Test connection failed or resolved to an unsafe target. No records were deleted.');
  }
};

/**
 * Deletes every document in every collection — guarded before each call.
 *
 * Revalidate both configuration and the actual Db object before every deletion.
 * No database-name override or remote opt-in can bypass these checks.
 */
export const resetTestDatabase = async (): Promise<void> => {
  const db = mongoose.connection.db;
  const validate = (): void => {
    const { target } = requireTestDatabaseConfig();
    const resolved = resolveTestTarget();
    assertSafeTestTarget(resolved);
    if (!db || db !== approvedDatabase || db !== mongoose.connection.db ||
        db.databaseName !== target.databaseName || mongoose.connection.readyState !== 1) {
      throw new UnsafeTestDatabaseError('Connection is not the approved disposable test database. No records were deleted.');
    }
  };
  validate();
  if (!db) throw new UnsafeTestDatabaseError('No approved database. No records were deleted.');
  const collections = await db.collections();
  for (const collection of collections) {
    validate();
    await collection.deleteMany({});
  }
};

export const disconnectTestDatabase = async (): Promise<void> => {
  approvedDatabase = null;
  await mongoose.disconnect();
};

export { UnsafeTestDatabaseError };
