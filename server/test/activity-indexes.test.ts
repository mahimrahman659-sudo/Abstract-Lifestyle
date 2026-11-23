import './setup-env.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';
import {
  ActivityEventModel,
  ACTIVITY_EVENT_TTL_SECONDS,
} from '../src/models/activity-event.model.js';
import { ingestClientEvents } from '../src/services/activity.service.js';
import { eventIngestSchema } from '../src/schemas/activity.schema.js';
import { env } from '../src/config/env.js';
import { makeEvent } from './helpers/activity.js';

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

const parseOne = (event: Record<string, unknown>) =>
  eventIngestSchema.parse({ consent: true, events: [event] }).events;

const CTX = { userId: null, consentGranted: true } as const;

const requireDb = (): NonNullable<typeof mongoose.connection.db> => {
  const db = mongoose.connection.db;
  assert.ok(db, 'connected database handle is available');
  return db;
};

/**
 * Ensures the collection exists, then applies the designed indexes.
 * `syncIndexes()` alone does not create a missing namespace on this driver.
 */
const syncActivityIndexes = async (): Promise<void> => {
  const db = requireDb();
  const existing = await db
    .listCollections({ name: 'activity_events' })
    .toArray();
  if (existing.length === 0) {
    await db.createCollection('activity_events');
  }
  await ActivityEventModel.syncIndexes();
};

describe('Phase 1A — activity indexes, degraded mode and TTL (disposable database)', () => {
  before(async () => {
    await connectTestDatabase();
    setFlag(true);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  after(async () => {
    setFlag(false);
    await disconnectTestDatabase();
  });

  it('ingests correctly with NO indexes present (degraded mode) and dedups within a batch', async () => {
    // Simulate a production collection that has not received the Phase 4
    // index rollout: drop everything, indexes included.
    await ActivityEventModel.collection.drop().catch(() => undefined);

    const shared = makeEvent();
    const first = await ingestClientEvents(parseOne(shared), CTX);
    assert.equal(first.status, 'stored', 'ingest must work without indexes');

    // Cross-batch duplicates are only collapsed by the unique index —
    // documented degradation: they are stored until the index exists.
    const second = await ingestClientEvents(parseOne(shared), CTX);
    assert.equal(second.status, 'stored');
    assert.equal(second.accepted, 1, 'no unique index → duplicate is stored');
    assert.equal(await ActivityEventModel.countDocuments({ eventId: shared.eventId }), 2);

    // In-batch deduplication still works at app level even with no indexes.
    const batch = eventIngestSchema.parse({
      consent: true,
      events: [makeEvent(), shared, shared],
    }).events;
    const third = await ingestClientEvents(batch, CTX);
    assert.equal(third.status, 'stored');
    assert.equal(third.accepted, 2, 'the two unique-in-batch events are stored');
    assert.equal(third.deduped, 1, 'the in-batch duplicate is collapsed');
    assert.equal(
      await ActivityEventModel.countDocuments({ eventId: shared.eventId }),
      3,
      'without the unique index, cross-batch duplicates accumulate (documented degradation)',
    );

    // Clean the duplicates, then restore the designed indexes for later tests.
    await ActivityEventModel.deleteMany({});
    await syncActivityIndexes();
  });

  it('creates every designed index with the expected keys and options', async () => {
    await syncActivityIndexes();
    const db = requireDb();
    const indexes = (await db
      .collection('activity_events')
      .indexes()) as unknown as Array<{
      name: string;
      key: Record<string, number>;
      unique?: boolean;
      sparse?: boolean;
      expireAfterSeconds?: number;
    }>;

    const byName = new Map(indexes.map((index) => [index.name, index]));
    const required = [
      'activity_eventId_unique',
      'activity_ts_ttl',
      'activity_type_ts',
      'activity_userId_ts',
      'activity_sessionId_ts',
      'activity_productId_ts',
    ];
    for (const name of required) {
      assert.ok(byName.has(name), `index ${name} must exist in the disposable database`);
    }

    const unique = byName.get('activity_eventId_unique');
    assert.equal(unique?.unique, true);
    assert.deepEqual(unique?.key, { eventId: 1 });

    const ttl = byName.get('activity_ts_ttl');
    assert.deepEqual(ttl?.key, { ts: 1 });
    assert.equal(
      ttl?.expireAfterSeconds,
      ACTIVITY_EVENT_TTL_SECONDS,
      'TTL matches the approved 90-day retention design',
    );

    const type = byName.get('activity_type_ts');
    assert.deepEqual(type?.key, { type: 1, ts: -1 });

    const user = byName.get('activity_userId_ts');
    assert.deepEqual(user?.key, { userId: 1, ts: -1 });
    assert.equal(user?.sparse, true, 'timeline index must be sparse (anonymous events)');

    const session = byName.get('activity_sessionId_ts');
    assert.deepEqual(session?.key, { sessionId: 1, ts: -1 });

    const product = byName.get('activity_productId_ts');
    assert.deepEqual(product?.key, { productId: 1, ts: -1 });
  });

  it('collapses cross-batch duplicates once the unique index exists', async () => {
    await syncActivityIndexes();
    const shared = makeEvent();
    const first = await ingestClientEvents(parseOne(shared), CTX);
    const second = await ingestClientEvents(parseOne(shared), CTX);
    assert.equal(first.status, 'stored');
    assert.equal(first.accepted, 1);
    assert.equal(second.status, 'stored');
    assert.equal(second.accepted, 0);
    assert.equal(second.deduped, 1);
    assert.equal(await ActivityEventModel.countDocuments({ eventId: shared.eventId }), 1);
  });

  it('does not modify any pre-existing collection indexes', async () => {
    await syncActivityIndexes();
    const db = requireDb();
    const names = (await db.listCollections().toArray()).map((entry) => entry.name);

    // activity_events is net-new and coexists with the legacy collections.
    assert.ok(names.includes('activity_events'), 'activity_events must exist');

    // Spot-check the concurrency-critical indexes that Phase 1A must never
    // touch — only when those collections already exist in this database.
    if (names.includes('orders')) {
      const orders = (await db.collection('orders').indexes()) as unknown as Array<{
        name: string;
        unique?: boolean;
      }>;
      const orderNumber = orders.find((index) => index.name === 'orderNumber_1');
      assert.ok(orderNumber, 'orders.orderNumber_1 must remain');
      assert.equal(orderNumber.unique, true, 'orders.orderNumber stays unique');
    }
    if (names.includes('carts')) {
      const carts = (await db.collection('carts').indexes()) as unknown as Array<{
        name: string;
        unique?: boolean;
      }>;
      const cartUser = carts.find((index) => index.name === 'user_1');
      assert.ok(cartUser, 'carts.user_1 must remain');
      assert.equal(cartUser.unique, true, 'carts.user stays unique');
    }
  });

  it('TTL monitor deletes an expired document on a disposable probe collection', async () => {
    const db = requireDb();
    const probe = db.collection('activity_ttl_probe');
    await probe.drop().catch(() => undefined);
    await probe.createIndex(
      { ts: 1 },
      { expireAfterSeconds: 1, name: 'activity_ttl_probe_ts' },
    );
    // Already eligible for deletion (ts is older than expireAfterSeconds).
    await probe.insertOne({ ts: new Date(Date.now() - 10_000) });
    assert.equal(await probe.countDocuments({}), 1);

    // MongoDB's TTL monitor runs about once a minute — poll generously.
    const deadline = Date.now() + 75_000;
    let count = 1;
    while (Date.now() < deadline) {
      count = await probe.countDocuments({});
      if (count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(count, 0, 'TTL monitor must remove the expired probe document');
    await probe.drop().catch(() => undefined);
  });
});
