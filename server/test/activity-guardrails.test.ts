import './setup-env.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Phase 1A guardrails: the activity foundation must not be wired into
 * checkout, orders or payments. These static checks fail the build if a
 * future edit introduces an activity import into a money/stock path —
 * business-event emission is deferred to Phase 1B (post-commit hooks only).
 */

const serverSrc = fileURLToPath(new URL('../src/', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(`${serverSrc}${relativePath}`, 'utf8');

const FORBIDDEN_ACTIVITY_PATTERN = /activity[\w./-]*\.js['"]|activity\.service|activity-event/i;

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

describe('Phase 1A — checkout/order/payment isolation (static guardrails)', () => {
  it('no money/stock source file references the activity module', () => {
    for (const path of MONEY_AND_STOCK_PATHS) {
      const source = readSource(path);
      assert.ok(
        !FORBIDDEN_ACTIVITY_PATTERN.test(source),
        `${path} must not reference activity (Phase 1B hooks must be reviewed separately)`,
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
