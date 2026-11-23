import './setup-env.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { makeBatch } from './helpers/activity.js';

/**
 * T4 — POST /api/events rate limit: 60 requests/minute per identity (or IP),
 * then 429 RATE_LIMITED. Runs in its own process (node:test spawns one per
 * file) so the in-memory limiter starts fresh. The feature flag stays at its
 * default (false) — limiting happens before any persistence concern.
 */
describe('Phase 1A — event ingest rate limit (HTTP, unit)', () => {
  let server: Server | undefined;
  let origin: string;

  before(async () => {
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  const post = (body: unknown) =>
    fetch(`${origin}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('answers the configured budget, then returns 429 RATE_LIMITED', async () => {
    const limit = env.ACTIVITY_EVENTS_RATE_LIMIT_PER_MIN;
    assert.equal(limit, 60, 'Phase 1A budget is 60/min by default');

    const payload = { consent: true, events: makeBatch(1) };
    for (let index = 0; index < limit; index += 1) {
      const response = await post(payload);
      assert.notEqual(
        response.status,
        429,
        `request ${index + 1} of ${limit} must not be rate limited`,
      );
      assert.ok(
        response.status === 204 || response.status === 202,
        `unexpected status ${response.status}`,
      );
    }

    const blocked = await post(payload);
    assert.equal(blocked.status, 429);
    const body = (await blocked.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'RATE_LIMITED');
  });
});
