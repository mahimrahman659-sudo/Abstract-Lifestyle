import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import {
  assertSafeTestTarget,
  assertSafeTestUri,
  UnsafeTestDatabaseError,
  requireTestDatabaseConfig,
} from './guards/test-database.js';
import { connectTestDatabase, disconnectTestDatabase, resetTestDatabase } from './helpers/test-db.js';
import { mockConnection } from './helpers/mock-connection.js';

const refuses = (operation: () => void, pattern: RegExp): void => {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof UnsafeTestDatabaseError, 'a typed refusal is raised');
    assert.match(error.message, pattern);
    assert.match(error.message, /No records were deleted|designated/, 'message states nothing was deleted');
    return true;
  });
};

describe('R2 — destructive test-database guard', () => {
  it('refuses a missing test configuration', () => {
    refuses(() => assertSafeTestUri(''), /not set/);
  });

  it('refuses a non-mongodb scheme', () => {
    refuses(() => assertSafeTestUri('postgres://127.0.0.1/db_test'), /mongodb:\/\//);
  });

  it('refuses an application database without the _test suffix', () => {
    refuses(
      () => assertSafeTestUri('mongodb://127.0.0.1:27018/abstract_lifestyle'),
      /must be named "\*_test"/,
    );
    refuses(
      () => assertSafeTestTarget({ databaseName: 'abstract_lifestyle', host: '127.0.0.1' }),
      /must be named "\*_test"/,
    );
  });

  it('refuses production/staging-looking names even with the suffix', () => {
    for (const name of ['shop_prod_test', 'staging_catalog_test', 'live_test']) {
      refuses(
        () => assertSafeTestTarget({ databaseName: name, host: '127.0.0.1' }),
        /production|staging|live|prod/i,
      );
    }
  });

  it('refuses the reserved application/system database names themselves', () => {
    for (const name of ['abstract_lifestyle', 'admin', 'config', 'local']) {
      refuses(
        () => assertSafeTestTarget({ databaseName: name, host: '127.0.0.1' }),
        /must be named/,
      );
    }
  });

  it('refuses a remote host', () => {
    refuses(
      () =>
        assertSafeTestTarget({
          databaseName: 'p0_integrity_test',
          host: 'cluster0.abc.mongodb.net',
        }),
      /remote host/,
    );
  });

  it('accepts only a local disposable test database', () => {
    assert.doesNotThrow(() =>
      assertSafeTestTarget({ databaseName: 'p0_integrity_test', host: '127.0.0.1' }),
    );
    assert.doesNotThrow(() =>
      assertSafeTestUri(
        'mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true',
      ),
    );
  });
});

describe('R2 — refusal cannot delete records (in-memory driver double)', () => {
  const keys = ['MONGODB_TEST_MODE', 'MONGODB_TEST_URI', 'MONGODB_TEST_ALLOW_REMOTE', 'MONGODB_URI'] as const;
  let saved: Array<string | undefined>;
  let records: number;
  let listings: number;
  const db = {
    databaseName: 'p0_integrity_test',
    collections: async () => {
      listings += 1;
      return [{ deleteMany: async () => { records = 0; } }];
    },
  };
  beforeEach(() => {
    saved = keys.map((key) => process.env[key]);
    process.env.MONGODB_TEST_MODE = 'disposable';
    process.env.MONGODB_TEST_URI = 'mongodb://127.0.0.1:27018/p0_integrity_test';
    records = 3;
    listings = 0;
    db.databaseName = 'p0_integrity_test';
  });
  afterEach(async () => {
    await disconnectTestDatabase();
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  it('requires intentional mode before opening a connection', async (t) => {
    const connect = mockConnection(t, db);
    delete process.env.MONGODB_TEST_MODE;
    await assert.rejects(connectTestDatabase(), /MONGODB_TEST_MODE/);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('never falls back to MONGODB_URI when test configuration is missing', async (t) => {
    const connect = mockConnection(t, db);
    delete process.env.MONGODB_TEST_URI;
    process.env.MONGODB_URI = 'mongodb://127.0.0.1/application_production';
    await assert.rejects(connectTestDatabase(), /MONGODB_TEST_URI is not set/);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a production-like URI despite explicit disposable mode', async (t) => {
    const connect = mockConnection(t, db);
    process.env.MONGODB_TEST_URI = 'mongodb://127.0.0.1/shop_production_test';
    await assert.rejects(connectTestDatabase(), /production\/staging/);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a production-like resolved name even when the URI is safe', async (t) => {
    db.databaseName = 'shop_prod_test';
    mockConnection(t, db);
    await assert.rejects(connectTestDatabase(), /unsafe target/);
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a different resolved test database', async (t) => {
    db.databaseName = 'another_test';
    mockConnection(t, db);
    await assert.rejects(connectTestDatabase(), /unsafe target/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a resolved remote target despite the old opt-in', async (t) => {
    mockConnection(t, db, 'staging.example.com');
    process.env.MONGODB_TEST_ALLOW_REMOTE = '1';
    await assert.rejects(connectTestDatabase(), /unsafe target/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('checks configuration again immediately before a reset', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    delete process.env.MONGODB_TEST_MODE;
    await assert.rejects(resetTestDatabase(), /MONGODB_TEST_MODE/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('checks the actual resolved database again immediately before a reset', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    db.databaseName = 'staging_test';
    await assert.rejects(resetTestDatabase(), /production\/staging/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('allows a guarded reset of the approved disposable database', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    await resetTestDatabase();
    assert.equal(records, 0);
    assert.equal(listings, 1);
  });
  it('refuses a replacement Db object even if it has the same safe name', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    Object.defineProperty(mongoose.connection, 'db', { value: { ...db }, configurable: true, writable: true });
    await assert.rejects(resetTestDatabase(), /not the approved/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('does not disclose credentials in validation failures', () => {
    assert.throws(
      () => requireTestDatabaseConfig({ MONGODB_TEST_MODE: 'disposable', MONGODB_TEST_URI: 'mongodb://private-user:private-password@staging.example.com/shop_prod_test' }),
      (error: unknown) => {
        assert.ok(error instanceof UnsafeTestDatabaseError);
        assert.doesNotMatch(error.message, /private-user|private-password/);
        return true;
      },
    );
  });
});
