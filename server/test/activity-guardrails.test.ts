import './setup-env.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Phase 1A/1B guardrails (static).
 *
 * Phase 1B-A/B rules:
 * - money/stock files may touch analytics ONLY through the fire-and-forget
 *   `emitServerEvent` helper (+ deterministic id util) — never the client
 *   ingest path, the event model, or the index-readiness internals;
 * - the activity service opens no transactions (failure isolation);
 * - readiness is verified before any insert (R-1);
 * - the controller catch logs message-only diagnostics (D-1);
 * - schema/model expose no PII or credential fields.
 */

const serverSrc = fileURLToPath(new URL('../src/', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(`${serverSrc}${relativePath}`, 'utf8');

/** Strips block and line comments so documentation words are not scanned. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const MONEY_AND_STOCK_PATHS = [
  'services/order.service.ts',
  'services/payment-claim.service.ts',
  'services/payment.service.ts',
  'services/admin-order.service.ts',
  'services/cart.service.ts',
  'models/order.model.ts',
  'models/cart.model.ts',
  'config/payment.ts',
  'config/payment-index.ts',
  'config/checkout.ts',
] as const;

/** Activity-module tokens no money file may reference besides the emit import. */
const FORBIDDEN_MONEY_ACTIVITY_TOKENS = [
  'ingestClientEvents',
  'resolveEventIdentity',
  'ActivityEventModel',
  'activity-index',
  'getActivityIndexReadiness',
  'insertMany',
] as const;

describe('Phase 1B — checkout/order/payment isolation (static guardrails)', () => {
  it('money/stock files reference activity ONLY via the emitServerEvent import', () => {
    for (const path of MONEY_AND_STOCK_PATHS) {
      const source = stripComments(readSource(path));
      for (const token of FORBIDDEN_MONEY_ACTIVITY_TOKENS) {
        assert.ok(
          !source.includes(token),
          `${path} must not reference "${token}" (only emitServerEvent is allowed)`,
        );
      }
      const activityLines = source
        .split('\n')
        .filter((line) => /activity/i.test(line));
      for (const line of activityLines) {
        assert.ok(
          /import/.test(line) &&
            /activity\.service\.js/.test(line) &&
            /emitServerEvent/.test(line),
          `${path}: activity reference must be the emitServerEvent import — got: ${line.trim()}`,
        );
      }
      // Fire-and-forget: emits are void, never awaited.
      assert.ok(
        !/await\s+emitServerEvent/.test(source),
        `${path} must not await emitServerEvent (fire-and-forget by contract)`,
      );
    }
  });

  it('transactions are never opened by the activity service', () => {
    const service = readSource('services/activity.service.ts');
    assert.ok(
      !service.includes('startSession'),
      'activity.service.ts must not start Mongo sessions',
    );
    assert.ok(
      !service.includes('withTransaction'),
      'activity.service.ts must never join a transaction',
    );
    assert.ok(
      !service.includes('endSession'),
      'activity.service.ts must not touch Mongo sessions at all',
    );
  });

  it('the event store is append-only from the service (no retroactive rewrites/merges)', () => {
    const service = stripComments(readSource('services/activity.service.ts'));
    for (const mutation of [
      'updateOne',
      'updateMany',
      'findOneAndUpdate',
      'bulkWrite',
      'deleteOne',
      'deleteMany',
      'replaceOne',
    ]) {
      assert.ok(
        !service.includes(mutation),
        `activity.service.ts must not perform "${mutation}" — events are immutable, ` +
          'anonymous sessions are never retroactively merged or rewritten',
      );
    }
    assert.ok(
      service.includes('insertMany'),
      'the only persistence operation is insert',
    );
  });

  it('readiness (R-1) is verified BEFORE any insert in the ingest path', () => {
    const service = readSource('services/activity.service.ts');
    const readinessAt = service.indexOf('getActivityIndexReadiness()');
    const insertAt = service.indexOf('insertMany');
    assert.ok(readinessAt !== -1, 'ingest must consult index readiness');
    assert.ok(insertAt !== -1, 'ingest must insert');
    assert.ok(
      readinessAt < insertAt,
      'readiness check must run before insertMany (fail-closed ordering)',
    );
    // Server events honor the same gate.
    const serverPersistAt = service.indexOf('const persistServerEvent');
    assert.ok(serverPersistAt !== -1);
    assert.ok(
      service.indexOf('getActivityIndexReadiness()', serverPersistAt) <
        service.indexOf('insertMany', serverPersistAt),
      'server-event persistence must check readiness before inserting',
    );
  });

  it('startup refuses flag-on deployments without ready indexes (connectDB gate)', () => {
    const db = stripComments(readSource('config/db.ts'));
    assert.ok(db.includes('ACTIVITY_EVENTS_ENABLED'), 'connectDB must consult the flag');
    assert.ok(
      db.includes('activityIndexRequirementMessage'),
      'connectDB must fail closed with the activity readiness message',
    );
    const health = stripComments(readSource('controllers/health.controller.ts'));
    assert.ok(
      health.includes('getActivityIndexReadiness'),
      'health readiness must report activity index status while required',
    );
  });

  it('controller diagnostics are message-only (D-1): no payloads, no request bodies', () => {
    const controller = readSource('controllers/event.controller.ts');
    assert.ok(controller.includes('console.error'), 'defensive catch must log (D-1)');
    // The catch may only log a bounded message derived from the error.
    assert.ok(
      !/console\.[a-z]+\([^)]*(req\.body|parsed\.events|JSON\.stringify\(parsed)/.test(
        controller,
      ),
      'controller diagnostics must never log payloads or request bodies',
    );
    assert.ok(
      controller.includes('slice(0, 300)'),
      'logged messages must be bounded',
    );
  });

  it('the activity schema exposes no PII or credential fields', () => {
    const schema = stripComments(readSource('schemas/activity.schema.ts'));
    const model = stripComments(readSource('models/activity-event.model.ts'));
    const denyList = [
      'password',
      'accessToken',
      'refreshToken',
      'otp',
      'trxId',
      'userAgent',
      'ipAddress',
      'phoneNumber',
      'shippingAddress',
      'senderNumber',
    ];
    for (const token of denyList) {
      assert.ok(
        !schema.includes(token),
        `schemas/activity.schema.ts must not mention "${token}"`,
      );
      assert.ok(
        !model.includes(token),
        `models/activity-event.model.ts must not mention "${token}"`,
      );
    }
  });

  it('the event rate limiter is mounted before validation on POST /api/events', () => {
    const routes = readSource('routes/event.routes.ts');
    const postAt = routes.indexOf('eventRouter.post');
    assert.ok(postAt !== -1, 'eventRouter.post must exist');
    const registration = routes.slice(postAt);
    const limiterAt = registration.indexOf('eventRateLimiter');
    const validateAt = registration.indexOf('validateBody');
    assert.ok(limiterAt !== -1, 'eventRateLimiter must be used');
    assert.ok(validateAt !== -1, 'validateBody must be used');
    assert.ok(
      limiterAt < validateAt,
      'rate limit must run before validation (cheap checks first)',
    );
    const index = readSource('routes/index.ts');
    assert.ok(
      index.includes("apiRouter.use('/events', eventRouter)"),
      'event router must be mounted under /api',
    );
  });

  it('the feature flag defaults to disabled in the environment schema', () => {
    const env = readSource('config/env.ts');
    const flagAt = env.indexOf('ACTIVITY_EVENTS_ENABLED');
    assert.ok(flagAt !== -1, 'ACTIVITY_EVENTS_ENABLED must be declared');
    // envBoolean defaults to 'false' — assert the declaration uses it.
    const declaration = env.slice(flagAt, flagAt + 120);
    assert.ok(
      declaration.includes('envBoolean'),
      'ACTIVITY_EVENTS_ENABLED must use the opt-in envBoolean helper (default false)',
    );
  });
});
