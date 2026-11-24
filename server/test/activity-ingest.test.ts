import './setup-env.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';
import {
  ActivityEventModel,
  ACTIVITY_EVENT_TTL_SECONDS,
} from '../src/models/activity-event.model.js';
import {
  clampEventTime,
  ingestClientEvents,
  normalizeEventPath,
  resolveEventIdentity,
} from '../src/services/activity.service.js';
import {
  eventIngestSchema,
  type ClientActivityEventInput,
} from '../src/schemas/activity.schema.js';
import { env } from '../src/config/env.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { makeEvent } from './helpers/activity.js';

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

const parseBatch = (events: Record<string, unknown>[]): ClientActivityEventInput[] =>
  eventIngestSchema.parse({ consent: true, events }).events;

const CTX_ANONYMOUS = { userId: null, consentGranted: true } as const;

describe('Phase 1A — activity ingest service (disposable database)', () => {
  before(async () => {
    await connectTestDatabase();
    await ActivityEventModel.syncIndexes();
    setFlag(true);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  after(async () => {
    setFlag(false);
    await disconnectTestDatabase();
  });

  it('persists validated client events with server-resolved identity only', async () => {
    const userId = new Types.ObjectId();
    const events = parseBatch([
      makeEvent({ path: '/products/linen-shirt', device: 'mobile', sessionId: 'sess-abcdefgh' }),
      makeEvent({ type: 'product.view', productId: new Types.ObjectId().toString() }),
    ]);
    const result = await ingestClientEvents(events, {
      userId,
      consentGranted: true,
    });
    assert.equal(result.status, 'stored');
    assert.equal(result.accepted, 2);
    assert.equal(result.deduped, 0);

    const docs = await ActivityEventModel.find({}).lean();
    assert.equal(docs.length, 2);
    for (const doc of docs) {
      assert.equal(doc.source, 'client');
      assert.equal(doc.userId?.toString(), userId.toString());
      assert.ok(doc.eventId);
      assert.ok(doc.createdAt instanceof Date);
    }
    // No PII-ish keys exist on the documents at all.
    for (const doc of docs) {
      const keys = Object.keys(doc);
      for (const forbidden of ['ip', 'userAgent', 'email', 'password', 'meta']) {
        assert.ok(!keys.includes(forbidden), `"${forbidden}" must not be stored`);
      }
    }
  });

  it('stores anonymous events with format-checked session identifiers', async () => {
    const events = parseBatch([
      makeEvent({ anonymousId: 'anon-0123456789ab', sessionId: 'sess-0123456789ab' }),
    ]);
    const result = await ingestClientEvents(events, CTX_ANONYMOUS);
    assert.equal(result.status, 'stored');
    const doc = await ActivityEventModel.findOne({}).lean();
    assert.ok(doc);
    assert.equal(doc.userId, undefined);
    assert.equal(doc.anonymousId, 'anon-0123456789ab');
    assert.equal(doc.sessionId, 'sess-0123456789ab');
  });

  it('deduplicates repeated event ids within a single batch', async () => {
    const shared = makeEvent();
    const events = parseBatch([shared, shared, makeEvent()]);
    const result = await ingestClientEvents(events, CTX_ANONYMOUS);
    assert.equal(result.status, 'stored');
    assert.equal(result.accepted, 2);
    assert.equal(result.deduped, 1);
    assert.equal(await ActivityEventModel.countDocuments({}), 2);
  });

  it('deduplicates re-submitted event ids across batches via the unique index', async () => {
    const events = parseBatch([makeEvent()]);
    const first = await ingestClientEvents(events, CTX_ANONYMOUS);
    const second = await ingestClientEvents(events, CTX_ANONYMOUS);
    assert.equal(first.status, 'stored');
    assert.equal(first.accepted, 1);
    assert.equal(second.status, 'stored');
    assert.equal(second.accepted, 0);
    assert.equal(second.deduped, 1);
    assert.equal(await ActivityEventModel.countDocuments({}), 1);
  });

  it('collapses concurrent duplicate submissions to exactly one document', async () => {
    const events = parseBatch([makeEvent()]);
    const [a, b] = await Promise.all([
      ingestClientEvents(events, CTX_ANONYMOUS),
      ingestClientEvents(events, CTX_ANONYMOUS),
    ]);
    assert.equal(a.status, 'stored');
    assert.equal(b.status, 'stored');
    assert.equal(a.accepted + b.accepted, 1, 'exactly one submission wins');
    assert.equal(a.deduped + b.deduped, 1, 'the loser is counted as deduped');
    assert.equal(await ActivityEventModel.countDocuments({}), 1);
  });

  it('ignores forged identity and business-state fields passed by a direct caller', async () => {
    const realUserId = new Types.ObjectId();
    const forgedUserId = new Types.ObjectId();
    const forged = {
      ...parseBatch([makeEvent()])[0],
      userId: forgedUserId.toString(),
      orderId: new Types.ObjectId().toString(),
      value: 99999999,
      paymentStatus: 'paid',
      ip: '198.51.100.7',
      userAgent: 'ForgedAgent/1.0',
      email: 'attacker@example.com',
      source: 'server',
      type: 'order.purchased',
    } as unknown as ClientActivityEventInput;

    // Type forgery is rejected outright (server-only type)…
    const rejected = await ingestClientEvents([forged], {
      userId: realUserId,
      consentGranted: true,
    });
    assert.equal(rejected.status, 'rejected');
    assert.equal(await ActivityEventModel.countDocuments({}), 0);

    // …and with a legitimate type, only the server-resolved identity persists.
    const legitimate = { ...forged, type: 'page.view' } as ClientActivityEventInput;
    const result = await ingestClientEvents([legitimate], {
      userId: realUserId,
      consentGranted: true,
    });
    assert.equal(result.status, 'stored');
    const doc = await ActivityEventModel.findOne({}).lean();
    assert.ok(doc);
    assert.equal(doc.userId?.toString(), realUserId.toString());
    assert.equal(doc.orderId, undefined);
    assert.equal(doc.value, undefined);
    const raw = doc as unknown as Record<string, unknown>;
    assert.equal(raw.paymentStatus, undefined);
    assert.equal(raw.ip, undefined);
    assert.equal(raw.email, undefined);
    assert.equal(doc.source, 'client');
    assert.equal(doc.type, 'page.view');
  });

  it('rejects server-authoritative event types on the client ingest path', async () => {
    for (const type of ['order.purchased', 'payment.refunded', 'admin.customer_viewed']) {
      // Bypass Zod on purpose: this asserts the service's own defense-in-depth
      // guard, not just the schema.
      const raw = { ...makeEvent({ type }) } as unknown as ClientActivityEventInput;
      const result = await ingestClientEvents([raw], CTX_ANONYMOUS);
      assert.equal(result.status, 'rejected', `${type} must be rejected`);
    }
    assert.equal(await ActivityEventModel.countDocuments({}), 0);
  });

  it('persists nothing when consent is not granted', async () => {
    const events = parseBatch([makeEvent()]);
    const result = await ingestClientEvents(events, {
      userId: null,
      consentGranted: false,
    });
    assert.equal(result.status, 'consent_denied');
    assert.equal(result.accepted, 0);
    assert.equal(await ActivityEventModel.countDocuments({}), 0);
  });

  it('persists nothing while the feature flag is disabled', async () => {
    setFlag(false);
    try {
      const events = parseBatch([makeEvent()]);
      const result = await ingestClientEvents(events, {
        userId: null,
        consentGranted: true,
      });
      assert.equal(result.status, 'disabled');
      assert.equal(result.accepted, 0);
      assert.equal(await ActivityEventModel.countDocuments({}), 0);
    } finally {
      setFlag(true);
    }
  });

  it('clamps client timestamps into [now-24h, now+5min]', async () => {
    const now = new Date();
    const ancient = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const events = parseBatch([
      makeEvent({ ts: ancient.toISOString() }),
      makeEvent({ ts: future.toISOString() }),
      makeEvent({ ts: now.toISOString() }),
    ]);
    const result = await ingestClientEvents(events, CTX_ANONYMOUS);
    assert.equal(result.status, 'stored');
    assert.equal(await ActivityEventModel.countDocuments({}), 3);

    const docs = await ActivityEventModel.find({}).lean();
    const ancientDoc = docs.find((doc) => doc.ts.getTime() < now.getTime() - 60 * 60 * 1000);
    const futureDoc = docs.find((doc) => doc.ts.getTime() > now.getTime() + 60 * 1000);
    const nowDoc = docs.find(
      (doc) =>
        Math.abs(doc.ts.getTime() - now.getTime()) < 60 * 1000,
    );
    assert.ok(ancientDoc, 'the ancient event was clamped forward, not stored as-is');
    assert.ok(futureDoc, 'the future event was clamped backward, not stored as-is');
    assert.ok(nowDoc, 'the in-range event is stored near "now"');
    // The service clamps against its own "now" (a few ms after the test's),
    // so exact equality would be flaky — allow a small tolerance.
    const toleranceMs = 5000;
    assert.ok(
      Math.abs(ancientDoc.ts.getTime() - (now.getTime() - 24 * 60 * 60 * 1000)) <= toleranceMs,
      'ancient ts equals now-24h within tolerance',
    );
    assert.ok(
      Math.abs(futureDoc.ts.getTime() - (now.getTime() + 5 * 60 * 1000)) <= toleranceMs,
      'future ts equals now+5min within tolerance',
    );

    // Unit-level clamp checks.
    assert.equal(clampEventTime(ancient, now).getTime(), now.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(clampEventTime(future, now).getTime(), now.getTime() + 5 * 60 * 1000);
    assert.equal(clampEventTime(now, now).getTime(), now.getTime());
    assert.equal(clampEventTime(new Date(Number.NaN), now).getTime(), now.getTime());
  });

  it('normalizes paths by stripping query strings and fragments', async () => {
    assert.equal(normalizeEventPath('/products/linen-shirt?ref=home'), '/products/linen-shirt');
    assert.equal(normalizeEventPath('/cart#summary'), '/cart');
    assert.equal(normalizeEventPath('/products/x?a=1#b'), '/products/x');
    assert.equal(normalizeEventPath('   /search   '), '/search');
    assert.equal(normalizeEventPath('?only=query'), undefined);
    assert.equal(normalizeEventPath('#'), undefined);
    assert.equal(normalizeEventPath('/x'.repeat(500))?.length, 200);

    // D-3 hardening: separator normalization + strict allowlist.
    assert.equal(normalizeEventPath('\\products\\linen'), '/products/linen');
    assert.equal(normalizeEventPath('//products///linen'), '/products/linen');
    assert.equal(normalizeEventPath('products/x'), '/products/x');
    assert.equal(normalizeEventPath('/'), '/');
    // Non-allowlisted content drops the field instead of persisting.
    assert.equal(normalizeEventPath('/products/ünïcode'), undefined, 'non-ASCII dropped');
    assert.equal(normalizeEventPath('/a b'), undefined, 'interior space dropped');
    assert.equal(
      normalizeEventPath('/a' + String.fromCharCode(0) + 'b'),
      undefined,
      'NUL dropped',
    );
    assert.equal(
      normalizeEventPath('/a' + String.fromCharCode(10) + 'b'),
      undefined,
      'newline dropped',
    );

    const events = parseBatch([makeEvent({ path: '/products/a?steal=1' })]);
    await ingestClientEvents(events, CTX_ANONYMOUS);
    const doc = await ActivityEventModel.findOne({}).lean();
    assert.equal(doc?.path, '/products/a');
  });

  it('never throws on storage failure and reports status "failed"', async () => {
    const model = ActivityEventModel as unknown as {
      insertMany: typeof ActivityEventModel.insertMany;
    };
    const original = model.insertMany;
    model.insertMany = (async () => {
      throw new Error('simulated storage outage');
    }) as typeof ActivityEventModel.insertMany;
    try {
      const events = parseBatch([makeEvent()]);
      const result = await ingestClientEvents(events, CTX_ANONYMOUS);
      assert.equal(result.status, 'failed');
      assert.equal(result.accepted, 0);
      assert.equal(result.deduped, 0);
    } finally {
      model.insertMany = original;
    }
    assert.equal(await ActivityEventModel.countDocuments({}), 0);
  });

  it('resolves identity from the verified cookie only', () => {
    const userId = new Types.ObjectId();
    const valid = signAuthToken(userId.toString(), 'customer');
    const asRequest = (cookieValue?: string): Request =>
      ({
        cookies: cookieValue === undefined ? {} : { al_token: cookieValue },
      }) as unknown as Request;

    assert.equal(resolveEventIdentity(asRequest()).userId, null, 'no cookie → anonymous');
    assert.equal(
      resolveEventIdentity(asRequest('forged.token.value')).userId,
      null,
      'forged cookie → anonymous',
    );
    assert.equal(
      resolveEventIdentity(asRequest('')).userId,
      null,
      'empty cookie → anonymous',
    );
    const attributed = resolveEventIdentity(asRequest(valid));
    assert.equal(attributed.userId?.toString(), userId.toString());

    // A token signed with a different secret is worthless.
    const foreign = jwt.sign({ sub: userId.toString(), role: 'admin' }, 'not-the-server-secret', {
      expiresIn: '1h',
    });
    assert.equal(
      resolveEventIdentity(asRequest(foreign)).userId,
      null,
      'foreign-secret token → anonymous',
    );
  });

  it('keeps retention TTL at the approved 90-day design value', () => {
    assert.equal(ACTIVITY_EVENT_TTL_SECONDS, 90 * 24 * 60 * 60);
    assert.equal(ACTIVITY_EVENT_TTL_SECONDS, 7_776_000);
  });

  it('reports only server-confirmed inserts on mixed partial failures (D-2)', async () => {
    const model = ActivityEventModel as unknown as {
      insertMany: typeof ActivityEventModel.insertMany;
    };
    const original = model.insertMany;

    // Mixed: 1 inserted (confirmed), 1 duplicate, 1 hard failure ⇒ accepted
    // counts ONLY the confirmed insert; the hard failure is never accepted.
    model.insertMany = (async () => {
      const error = new Error('probe: mixed') as Error & {
        writeErrors: Array<{ code: number }>;
        result: { insertedCount: number };
      };
      error.writeErrors = [{ code: 11000 }, { code: 12345 }];
      error.result = { insertedCount: 1 };
      throw error;
    }) as typeof ActivityEventModel.insertMany;
    try {
      const mixed = await ingestClientEvents(parseBatch([makeEvent(), makeEvent()]), CTX_ANONYMOUS);
      assert.equal(mixed.status, 'failed', 'mixed failure is a failure');
      assert.equal(mixed.accepted, 1, 'accepted = server-confirmed inserts only');
      assert.equal(mixed.deduped, 1, 'duplicates still counted as deduped');
    } finally {
      model.insertMany = original;
    }

    // All duplicates ⇒ idempotent stored path with driver-confirmed counts.
    model.insertMany = (async () => {
      const error = new Error('probe: all dup') as Error & {
        writeErrors: Array<{ code: number }>;
        result: { insertedCount: number };
      };
      error.writeErrors = [{ code: 11000 }, { code: 11000 }];
      error.result = { insertedCount: 0 };
      throw error;
    }) as typeof ActivityEventModel.insertMany;
    try {
      const dupes = await ingestClientEvents(parseBatch([makeEvent(), makeEvent()]), CTX_ANONYMOUS);
      assert.equal(dupes.status, 'stored');
      assert.equal(dupes.accepted, 0, 'zero confirmed inserts ⇒ zero accepted');
      assert.equal(dupes.deduped, 2);
    } finally {
      model.insertMany = original;
    }

    // Hard failure with NO driver result ⇒ accepted must be 0 (unknown ≠ success).
    model.insertMany = (async () => {
      const error = new Error('probe: hard') as Error & {
        writeErrors: Array<{ code: number }>;
      };
      error.writeErrors = [{ code: 12345 }];
      throw error;
    }) as typeof ActivityEventModel.insertMany;
    try {
      const hard = await ingestClientEvents(parseBatch([makeEvent()]), CTX_ANONYMOUS);
      assert.equal(hard.status, 'failed');
      assert.equal(hard.accepted, 0, 'failed inserts are never reported as accepted');
      assert.equal(hard.deduped, 0);
    } finally {
      model.insertMany = original;
    }
  });

  it('refuses ingestion while required indexes are missing, then resumes (R-1)', async () => {
    const db = mongoose.connection.db;
    assert.ok(db);
    await ActivityEventModel.collection.drop().catch(() => undefined);

    const refused = await ingestClientEvents(parseBatch([makeEvent()]), CTX_ANONYMOUS);
    assert.equal(refused.status, 'index_not_ready');
    assert.equal(refused.accepted, 0);
    assert.equal(await ActivityEventModel.countDocuments({}), 0);

    // Restore indexes (disposable DB only) and confirm normal operation.
    const existing = await db.listCollections({ name: 'activity_events' }).toArray();
    if (existing.length === 0) {
      await db.createCollection('activity_events');
    }
    await ActivityEventModel.syncIndexes();
    const resumed = await ingestClientEvents(parseBatch([makeEvent()]), CTX_ANONYMOUS);
    assert.equal(resumed.status, 'stored');
    assert.equal(resumed.accepted, 1);
    assert.equal(await ActivityEventModel.countDocuments({}), 1);
  });
});
