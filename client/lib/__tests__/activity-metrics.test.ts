import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  customerEventLink,
  displayLiveMetric,
  METRIC_UNAVAILABLE,
  sessionListMode,
} from '../utils/activity-metrics.ts';
import type { ActivityEventDto } from '../types';

describe('Phase 2 corrections — live metric display (M-1)', () => {
  it('preserves real zeros while tracking is running', () => {
    assert.equal(displayLiveMetric(true, 0), '0', 'a genuine zero stays a zero');
    assert.equal(displayLiveMetric(true, 7), '7');
  });

  it('renders unavailable (—), never a zero, while tracking is disabled', () => {
    assert.equal(displayLiveMetric(false, 0), METRIC_UNAVAILABLE);
    assert.equal(displayLiveMetric(false, 0), '—');
    assert.equal(displayLiveMetric(false, 42), METRIC_UNAVAILABLE);
    assert.notEqual(displayLiveMetric(false, 0), '0');
  });
});

describe('Phase 2 corrections — session list states', () => {
  it('distinguishes disabled, empty and populated states', () => {
    assert.equal(sessionListMode(false, 0), 'disabled');
    assert.equal(sessionListMode(false, 5), 'disabled', 'disabled beats historical rows');
    assert.equal(sessionListMode(true, 0), 'empty', 'real zero while collecting');
    assert.equal(sessionListMode(true, 3), 'list');
  });
});

describe('Phase 2 corrections — customer feed links (L-1)', () => {
  const base = { userId: '656f0c9e8a8f8e0000000001' };

  it('links customer-actor events to the acting customer', () => {
    const link = customerEventLink({
      ...base,
      type: 'cart.add',
      customerId: undefined,
    } as Pick<ActivityEventDto, 'type' | 'userId' | 'customerId'>);
    assert.deepEqual(link, {
      href: '/admin/customers/656f0c9e8a8f8e0000000001',
      label: 'customer',
    });
  });

  it('never labels admin-actor events as a customer (misleading-link fix)', () => {
    for (const type of [
      'admin.order_status_changed',
      'admin.customer_viewed',
      'payment.claim_reviewed',
      'payment.refunded',
    ] as const) {
      const link = customerEventLink({
        userId: '656f0c9e8a8f8e0000000009',
        customerId: type === 'admin.customer_viewed' ? '656f0c9e8a8f8e0000000001' : undefined,
        type,
      });
      if (type === 'admin.customer_viewed') {
        // Links the VIEWED customer, not the admin actor.
        assert.deepEqual(link, {
          href: '/admin/customers/656f0c9e8a8f8e0000000001',
          label: 'viewed customer',
        });
      } else {
        assert.equal(link, null, `${type} must not render a customer link`);
      }
    }
  });

  it('returns null for anonymous or unlinked events', () => {
    assert.equal(
      customerEventLink({ type: 'page.view', userId: undefined, customerId: undefined }),
      null,
    );
    assert.equal(
      customerEventLink({ type: 'admin.order_status_changed', userId: 'x', customerId: undefined }),
      null,
    );
  });
});
