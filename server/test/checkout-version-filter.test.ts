import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cartVersionFilter } from '../src/config/checkout.js';

describe('B1 — cart version compare-and-swap filter', () => {
  it('accepts legacy carts that have no stored version when expecting 0', () => {
    assert.deepEqual(cartVersionFilter(0), {
      $or: [{ version: 0 }, { version: { $exists: false } }],
    });
  });

  it('matches the exact version for a cart that already has one', () => {
    assert.deepEqual(cartVersionFilter(3), { version: 3 });
  });
});
