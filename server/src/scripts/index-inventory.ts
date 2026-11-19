/**
 * Read-only index inventory for a disposable test database. It never creates,
 * drops or modifies indexes. Production verification must be performed with the
 * documented read-only mongosh commands instead.
 *
 * Usage:
 *   $env:MONGODB_TEST_MODE='disposable'
 *   $env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_index_test?replicaSet=rs0&directConnection=true'
 *   npm run index-inventory -- --status
 *   npm run index-inventory -- --inventory
 */
import mongoose from 'mongoose';
import {
  formatIndexInventory,
  readIndexInventory,
} from '../config/index-inventory.js';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const requireDisposableTarget = (): string => {
  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to inspect a production database. No index was changed.');
  }
  if (process.env.MONGODB_TEST_MODE !== 'disposable') {
    fail('Set MONGODB_TEST_MODE=disposable. No index was changed.');
  }
  const uri = (process.env.MONGODB_TEST_URI ?? '').trim();
  if (!uri) {
    fail('Set MONGODB_TEST_URI to a disposable local replica set. No index was changed.');
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return fail('MONGODB_TEST_URI is not a valid URL. No index was changed.');
  }
  const host = parsed.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    fail('Only loopback test databases are allowed. No index was changed.');
  }
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test') || /prod|live|staging/i.test(databaseName)) {
    fail('The test database name must end in _test and must not look production-like.');
  }
  return uri;
};

const main = async (): Promise<void> => {
  const uri = requireDisposableTarget();
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('No database handle is available.');
    }
    const comparison = await readIndexInventory(db);
    console.log(formatIndexInventory(comparison));
    if (!comparison.ok) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Index inventory failed.');
  process.exit(1);
});
