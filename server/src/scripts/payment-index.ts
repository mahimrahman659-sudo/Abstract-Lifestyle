/**
 * Disposable-database index helper for the manual-payment TrxID uniqueness
 * index. It refuses production and any non-local / non-`_test` target, and it
 * never edits order data.
 *
 * Usage (after starting a disposable replica set):
 *   $env:MONGODB_TEST_MODE='disposable'
 *   $env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_payments_test?replicaSet=rs0&directConnection=true'
 *   npm run payment-index -- --apply
 *   npm run payment-index -- --status
 *   npm run payment-index -- --rollback
 */
import mongoose from 'mongoose';
import { OrderModel } from '../models/order.model.js';

const INDEX_NAME = 'payment_trxid_unique';
const INDEX_KEY = { 'payment.claims.trxIdNormalized': 1 };
const INDEX_OPTIONS = {
  name: INDEX_NAME,
  unique: true,
  partialFilterExpression: { 'payment.claims.trxIdNormalized': { $type: 'string' } },
} as const;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const requireDisposableTarget = (): string => {
  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run against production. No index was changed.');
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
  const action = process.argv.includes('--apply')
    ? 'apply'
    : process.argv.includes('--rollback')
      ? 'rollback'
      : 'status';

  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  try {
    const collection = OrderModel.collection;
    if (action === 'apply') {
      console.log(`Creating index ${INDEX_NAME}...`);
      await collection.createIndex(INDEX_KEY, INDEX_OPTIONS);
      console.log(`Created ${INDEX_NAME}.`);
    } else if (action === 'rollback') {
      console.log(`Dropping index ${INDEX_NAME}...`);
      try {
        await collection.dropIndex(INDEX_NAME);
        console.log(`Dropped ${INDEX_NAME}.`);
      } catch (error) {
        const codeName =
          typeof error === 'object' && error !== null && 'codeName' in error
            ? (error as { codeName?: unknown }).codeName
            : undefined;
        if (codeName === 'IndexNotFound') {
          console.log(`Index ${INDEX_NAME} does not exist; nothing to drop.`);
        } else {
          throw error;
        }
      }
    } else {
      const indexes = await collection.indexes();
      const found = indexes.find((index) => index.name === INDEX_NAME);
      console.log(found ? JSON.stringify(found, null, 2) : `Index ${INDEX_NAME} not found.`);
    }
  } finally {
    await mongoose.disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Index helper failed.');
  process.exit(1);
});
