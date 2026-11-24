import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';
import { ActivityEventModel } from '../src/models/activity-event.model.js';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { makeBatch, makeEvent, postEvents } from './helpers/activity.js';

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

const AUTH_COOKIE = 'al_token';

describe('Phase 1A — POST /api/events (HTTP + disposable database)', () => {
  let server: Server | undefined;
  let origin: string;

  before(async () => {
    await connectTestDatabase();
    await ActivityEventModel.syncIndexes();
    setFlag(true);
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase();
    setFlag(true);
  });

  after(async () => {
    setFlag(false);
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectTestDatabase();
  });

  it('answers 202, persists the batch and attributes identity from a valid cookie', async () => {
    const userId = new Types.ObjectId();
    const cookie = `${AUTH_COOKIE}=${signAuthToken(userId.toString(), 'customer')}`;
    const events = makeBatch(3, { path: '/products/linen-shirt' });
    const response = await postEvents(origin, { consent: true, events }, cookie);

    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { accepted: 3, deduped: 0 });
    const docs = await ActivityEventModel.find({}).lean();
    assert.equal(docs.length, 3);
    for (const doc of docs) {
      assert.equal(doc.userId?.toString(), userId.toString());
      assert.equal(doc.source, 'client');
    }
  });

  it('answers 202 without identity when no cookie is sent', async () => {
    const response = await postEvents(origin, {
      consent: true,
      events: makeBatch(1, { anonymousId: 'anon-0123456789ab' }),
    });
    assert.equal(response.status, 202);
    const doc = await ActivityEventModel.findOne({}).lean();
    assert.ok(doc);
    assert.equal(doc.userId, undefined);
    assert.equal(doc.anonymousId, 'anon-0123456789ab');
  });

  it('treats a forged cookie as anonymous — never as the forged identity', async () => {
    const response = await postEvents(
      origin,
      { consent: true, events: makeBatch(1) },
      `${AUTH_COOKIE}=not.a.valid.jwt`,
    );
    assert.equal(response.status, 202);
    const doc = await ActivityEventModel.findOne({}).lean();
    assert.ok(doc);
    assert.equal(doc.userId, undefined);
  });

  it('answers 204 and persists nothing when consent is absent or false', async () => {
    const withoutConsent = await postEvents(origin, { events: makeBatch(1) });
    assert.equal(withoutConsent.status, 204);
    const denied = await postEvents(origin, { consent: false, events: makeBatch(1) });
    assert.equal(denied.status, 204);
    assert.equal(await ActivityEventModel.countDocuments({}), 0);
  });

  it('answers 204 and persists nothing while the feature flag is disabled', async () => {
    setFlag(false);
    const response = await postEvents(origin, { consent: true, events: makeBatch(2) });
    assert.equal(response.status, 204);
    assert.equal(await ActivityEventModel.countDocuments({}), 0);
  });

  it('rejects forbidden business events and oversized batches with 400', async () => {
    const forbidden = await postEvents(origin, {
      consent: true,
      events: [makeEvent({ type: 'order.purchased' })],
    });
    assert.equal(forbidden.status, 400);
    const envelope = forbidden.body as { error?: { code?: string } };
    assert.equal(envelope.error?.code, 'VALIDATION_ERROR');

    const oversized = await postEvents(origin, {
      consent: true,
      events: makeBatch(21),
    });
    assert.equal(oversized.status, 400);

    const badId = await postEvents(origin, {
      consent: true,
      events: [makeEvent({ eventId: 'nope' })],
    });
    assert.equal(badId.status, 400);

    const badConsent = await postEvents(origin, {
      consent: 'true',
      events: makeBatch(1),
    });
    assert.equal(badConsent.status, 400);

    assert.equal(await ActivityEventModel.countDocuments({}), 0);
  });

  it('never persists client-supplied identity, PII or business-state fields', async () => {
    const response = await postEvents(origin, {
      consent: true,
      events: [
        makeEvent({
          userId: new Types.ObjectId().toString(),
          orderId: new Types.ObjectId().toString(),
          value: 424242,
          paymentStatus: 'paid',
          ip: '203.0.113.10',
          userAgent: 'EvilBot/1.0',
          email: 'victim@example.com',
          password: 'hunter2',
          meta: { anything: true },
        }),
      ],
    });
    assert.equal(response.status, 202);
    const doc = await ActivityEventModel.findOne({}).lean();
    assert.ok(doc);
    const keys = Object.keys(doc);
    for (const forbidden of [
      'userId',
      'orderId',
      'value',
      'paymentStatus',
      'ip',
      'userAgent',
      'email',
      'password',
      'meta',
    ]) {
      assert.ok(!keys.includes(forbidden), `"${forbidden}" must not be stored`);
    }
  });

  it('deduplicates an identical replayed batch (HTTP level)', async () => {
    const events = makeBatch(2);
    const first = await postEvents(origin, { consent: true, events });
    assert.equal(first.status, 202);
    assert.deepEqual(first.body, { accepted: 2, deduped: 0 });

    const replay = await postEvents(origin, { consent: true, events });
    assert.equal(replay.status, 202);
    assert.deepEqual(replay.body, { accepted: 0, deduped: 2 });
    assert.equal(await ActivityEventModel.countDocuments({}), 2);
  });

  it('answers 202 with zero counts when storage is unavailable', async () => {
    const model = ActivityEventModel as unknown as {
      insertMany: typeof ActivityEventModel.insertMany;
    };
    const original = model.insertMany;
    model.insertMany = (async () => {
      throw new Error('simulated storage outage');
    }) as typeof ActivityEventModel.insertMany;
    try {
      const response = await postEvents(origin, {
        consent: true,
        events: makeBatch(1),
      });
      assert.equal(response.status, 202);
      assert.deepEqual(response.body, { accepted: 0, deduped: 0 });
    } finally {
      model.insertMany = original;
    }
    assert.equal(await ActivityEventModel.countDocuments({}), 0);
  });

  it('attributes events to whichever identity the cookie proves — never to a payload claim', async () => {
    const realUser = new Types.ObjectId();
    const spoofed = new Types.ObjectId();
    const response = await postEvents(
      origin,
      {
        consent: true,
        events: [
          makeEvent({
            userId: spoofed.toString(), // must be stripped by validation
            type: 'page.view',
          }),
        ],
      },
      `${AUTH_COOKIE}=${signAuthToken(realUser.toString(), 'customer')}`,
    );
    assert.equal(response.status, 202);
    const doc = await ActivityEventModel.findOne({}).lean();
    assert.ok(doc);
    assert.equal(doc.userId?.toString(), realUser.toString());
    assert.notEqual(doc.userId?.toString(), spoofed.toString());
    assert.equal(await ActivityEventModel.countDocuments({ userId: spoofed }), 0);
  });

  it('keeps batch size capped at 20 events end-to-end', async () => {
    const atCap = await postEvents(origin, {
      consent: true,
      events: makeBatch(20),
    });
    assert.equal(atCap.status, 202);
    assert.equal(await ActivityEventModel.countDocuments({}), 20);
    assert.equal(randomUUID().length, 36, 'sanity: fixture ids are UUIDs');
  });

  it('answers 503 ACTIVITY_INDEX_UNAVAILABLE when indexes are missing while enabled (R-1)', async () => {
    await ActivityEventModel.collection.drop().catch(() => undefined);

    const refused = await postEvents(origin, { consent: true, events: makeBatch(1) });
    assert.equal(refused.status, 503);
    const envelope = refused.body as { error?: { code?: string } };
    assert.equal(envelope.error?.code, 'ACTIVITY_INDEX_UNAVAILABLE');
    assert.equal(await ActivityEventModel.countDocuments({}), 0, 'zero writes while not ready');

    // Concurrent duplicates while not ready are BOTH refused (never accepted).
    const [a, b] = await Promise.all([
      postEvents(origin, { consent: true, events: makeBatch(1) }),
      postEvents(origin, { consent: true, events: makeBatch(1) }),
    ]);
    assert.equal(a.status, 503);
    assert.equal(b.status, 503);
    assert.equal(await ActivityEventModel.countDocuments({}), 0);

    // Restore the designed indexes (disposable DB only) ⇒ normal 202 again.
    const db = mongoose.connection.db;
    assert.ok(db);
    const existing = await db.listCollections({ name: 'activity_events' }).toArray();
    if (existing.length === 0) {
      await db.createCollection('activity_events');
    }
    await ActivityEventModel.syncIndexes();
    const resumed = await postEvents(origin, { consent: true, events: makeBatch(1) });
    assert.equal(resumed.status, 202);
    assert.deepEqual(resumed.body, { accepted: 1, deduped: 0 });
  });
});
