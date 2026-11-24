import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  eventIngestSchema,
  clientActivityEventSchema,
  MAX_EVENT_BATCH,
} from '../src/schemas/activity.schema.js';
import { CLIENT_ACTIVITY_EVENT_TYPES } from '../src/models/activity-event.model.js';
import { makeBatch, makeEvent } from './helpers/activity.js';

describe('Phase 1A — activity event input schema (unit)', () => {
  it('accepts a minimal valid batch and defaults consent to false', () => {
    const parsed = eventIngestSchema.parse({ events: [makeEvent()] });
    assert.equal(parsed.consent, false);
    assert.equal(parsed.events.length, 1);
    assert.ok(parsed.events[0]?.eventId);
  });

  it('rejects empty batches and batches above the 20-event cap', () => {
    assert.throws(() => eventIngestSchema.parse({ events: [] }));
    assert.throws(() =>
      eventIngestSchema.parse({ events: makeBatch(MAX_EVENT_BATCH + 1) }),
    );
    // Exactly at the cap is fine.
    const atCap = eventIngestSchema.parse({ events: makeBatch(MAX_EVENT_BATCH) });
    assert.equal(atCap.events.length, MAX_EVENT_BATCH);
  });

  it('rejects unsupported event types, including client claims of order/payment outcomes', () => {
    const forbidden = [
      'order.purchased',
      'order.cancelled',
      'payment.claim_submitted',
      'payment.claim_reviewed',
      'payment.refunded',
      'checkout.started',
      'auth.login',
      'cart.add',
      'admin.customer_viewed',
      'not.a.real.type',
      'PAGE.VIEW',
    ];
    for (const type of forbidden) {
      assert.throws(
        () => eventIngestSchema.parse({ events: [makeEvent({ type })] }),
        `type "${type}" must be rejected`,
      );
    }
    // The full client-accepted list parses.
    for (const type of CLIENT_ACTIVITY_EVENT_TYPES) {
      const parsed = eventIngestSchema.parse({ events: [makeEvent({ type })] });
      assert.equal(parsed.events[0]?.type, type);
    }
  });

  it('requires UUID v4 event ids and rejects lookalikes', () => {
    const badIds = [
      undefined,
      '',
      'not-a-uuid',
      randomUUID().toUpperCase().replace(/-/g, ''), // hex without dashes
      '123e4567-e89b-12d3-a456-426614174000', // UUID v1
      '123e4567-e89b-62d3-a456-426614174000', // UUID v6-ish (not 4xxx)
      `${randomUUID()}x`,
      '123e4567e89b42d3a456426614174000', // no dashes
    ];
    for (const eventId of badIds) {
      assert.throws(
        () => clientActivityEventSchema.parse(makeEvent({ eventId })),
        `eventId "${String(eventId)}" must be rejected`,
      );
    }
    const ok = clientActivityEventSchema.parse(makeEvent());
    assert.match(ok.eventId, /^[0-9a-f-]{36}$/i);
  });

  it('strips client-supplied identity and privileged business-state fields', () => {
    const forged = makeEvent({
      userId: '0123456789abcdef01234567',
      orderId: '0123456789abcdef01234567',
      value: 999999,
      paymentStatus: 'paid',
      refundAmount: 1,
      trxId: 'FAKETRX123',
      ip: '203.0.113.9',
      userAgent: 'EvilBot/1.0',
      email: 'victim@example.com',
      phone: '01700000000',
      address: 'House 1, Road 1, Dhaka',
      password: 'hunter2',
      otp: '123456',
      accessToken: 'secret-token',
      role: 'admin',
      source: 'server',
      meta: { any: 'object' },
      context: { nested: true },
    });
    const parsed = clientActivityEventSchema.parse(forged);
    const keys = Object.keys(parsed);
    const forbiddenKeys = [
      'userId',
      'orderId',
      'value',
      'paymentStatus',
      'refundAmount',
      'trxId',
      'ip',
      'userAgent',
      'email',
      'phone',
      'address',
      'password',
      'otp',
      'accessToken',
      'role',
      'source',
      'meta',
      'context',
    ];
    for (const key of forbiddenKeys) {
      assert.ok(!keys.includes(key), `"${key}" must not survive validation`);
      assert.ok(!(key in parsed), `"${key}" must not be present on the parsed event`);
    }
    // The allowed surface stays intact.
    assert.equal(parsed.eventId, forged.eventId);
    assert.equal(parsed.type, 'page.view');
  });

  it('enforces bounds on every free-text and numeric field', () => {
    assert.throws(() =>
      clientActivityEventSchema.parse(makeEvent({ path: '/x'.repeat(200) })),
    );
    assert.throws(() =>
      clientActivityEventSchema.parse(makeEvent({ query: 'q'.repeat(101) })),
    );
    assert.throws(() => clientActivityEventSchema.parse(makeEvent({ quantity: 0 })));
    assert.throws(() => clientActivityEventSchema.parse(makeEvent({ quantity: 1000 })));
    assert.throws(() => clientActivityEventSchema.parse(makeEvent({ quantity: 1.5 })));
    assert.throws(() => clientActivityEventSchema.parse(makeEvent({ device: 'watch' })));
    assert.throws(() =>
      clientActivityEventSchema.parse(makeEvent({ anonymousId: 'short' })),
    );
    assert.throws(() =>
      clientActivityEventSchema.parse(makeEvent({ sessionId: 'bad id with spaces!' })),
    );
    // referrerDomain must be a bare hostname — no scheme, path or port.
    for (const referrerDomain of [
      'https://evil.example.com',
      'evil.example.com/path',
      'evil.example.com:8080',
      'user:pass@evil.example.com',
      '',
    ]) {
      assert.throws(
        () => clientActivityEventSchema.parse(makeEvent({ referrerDomain })),
        `referrerDomain "${referrerDomain}" must be rejected`,
      );
    }
    assert.equal(
      clientActivityEventSchema.parse(makeEvent({ referrerDomain: 'shop.example.com' }))
        .referrerDomain,
      'shop.example.com',
    );
  });

  it('rejects paths containing control characters (D-3 edge validation)', () => {
    const controlPaths = [
      '/a' + String.fromCharCode(0) + 'b',
      '/a' + String.fromCharCode(10) + 'b',
      '/a' + String.fromCharCode(13) + 'b',
      '/a' + String.fromCharCode(7) + 'b',
      '/a' + String.fromCharCode(31) + 'b',
      '/a' + String.fromCharCode(127) + 'b',
    ];
    for (const path of controlPaths) {
      assert.throws(
        () => clientActivityEventSchema.parse(makeEvent({ path })),
        `path ${JSON.stringify(path)} must be rejected at the edge`,
      );
    }
    // Printable routes pass the edge check (query strings are stripped later
    // by the service allowlist, not rejected here).
    for (const path of ['/products/linen-shirt?ref=home', '/cart#x', '/products/a%20b']) {
      const parsed = clientActivityEventSchema.parse(makeEvent({ path }));
      assert.equal(parsed.path, path);
    }
    // Over-length paths are rejected before normalization.
    assert.throws(() => clientActivityEventSchema.parse(makeEvent({ path: '/x'.repeat(200) })));
  });

  it('coerces ISO timestamps and rejects unparseable or non-timestamp values', () => {
    const parsed = clientActivityEventSchema.parse(
      makeEvent({ ts: '2026-11-24T10:00:00.000Z' }),
    );
    assert.ok(parsed.ts instanceof Date);
    assert.equal(parsed.ts.toISOString(), '2026-11-24T10:00:00.000Z');
    // Epoch milliseconds are accepted; Dates pass through.
    const epoch = clientActivityEventSchema.parse(makeEvent({ ts: Date.now() }));
    assert.ok(epoch.ts instanceof Date);
    const direct = clientActivityEventSchema.parse(makeEvent({ ts: new Date() }));
    assert.ok(direct.ts instanceof Date);
    // Junk that `z.coerce.date()` would have silently turned into 1970.
    // (A small numeric epoch like 12 is a valid timestamp and is accepted —
    // the service clamps out-of-range times to [now-24h, now+5min].)
    for (const ts of ['not-a-date', true, null, [], {}]) {
      assert.throws(
        () => clientActivityEventSchema.parse(makeEvent({ ts })),
        `ts ${JSON.stringify(ts)} must be rejected`,
      );
    }
    assert.ok(clientActivityEventSchema.parse(makeEvent({ ts: 12 })).ts instanceof Date);
  });

  it('requires a strict boolean consent flag (no truthy strings)', () => {
    assert.throws(() => eventIngestSchema.parse({ consent: 'true', events: [makeEvent()] }));
    assert.throws(() => eventIngestSchema.parse({ consent: 1, events: [makeEvent()] }));
    assert.equal(
      eventIngestSchema.parse({ consent: true, events: [makeEvent()] }).consent,
      true,
    );
  });
});
