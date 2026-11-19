import './setup-env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareIndexInventory,
  type ActualIndex,
  type ExpectedIndex,
} from '../src/config/index-inventory.js';

const expected = (
  overrides: Partial<ExpectedIndex> = {},
): ExpectedIndex => ({
  collection: 'orders',
  name: 'orderNumber_1',
  key: { orderNumber: 1 },
  unique: true,
  sparse: false,
  partialFilterExpression: null,
  expireAfterSeconds: null,
  textFields: [],
  requireExactName: false,
  ...overrides,
});

const actual = (overrides: Partial<ActualIndex> = {}): ActualIndex => ({
  name: 'orderNumber_1',
  key: { orderNumber: 1 },
  unique: true,
  sparse: false,
  partialFilterExpression: null,
  expireAfterSeconds: null,
  weights: null,
  ...overrides,
});

describe('index inventory — pure comparison', () => {
  it('accepts a matching inventory', () => {
    const result = compareIndexInventory([expected()], { orders: [actual()] });
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
    assert.equal(result.mismatched.length, 0);
  });

  it('reports missing and extra indexes', () => {
    const result = compareIndexInventory([expected()], {
      orders: [actual({ name: 'legacy_1', key: { legacy: 1 } })],
    });
    assert.equal(result.ok, false);
    assert.equal(result.missing.length, 1);
    assert.equal(result.extras.length, 1);
  });

  it('reports key, unique, sparse and partial-filter mismatches', () => {
    assert.equal(
      compareIndexInventory([expected()], {
        orders: [actual({ key: { orderNumber: -1 } })],
      }).mismatched[0]?.reason.includes('key'),
      true,
    );
    assert.equal(
      compareIndexInventory([expected()], {
        orders: [actual({ unique: false })],
      }).mismatched[0]?.reason.includes('unique'),
      true,
    );
    assert.equal(
      compareIndexInventory([expected({ sparse: true })], {
        orders: [actual({ sparse: false })],
      }).mismatched[0]?.reason.includes('sparse'),
      true,
    );
    assert.equal(
      compareIndexInventory(
        [expected({ partialFilterExpression: { active: true } })],
        { orders: [actual({ partialFilterExpression: { active: false } })] },
      ).mismatched[0]?.reason.includes('partialFilterExpression'),
      true,
    );
  });

  it('treats a differently named functional index as a warning, except the payment index', () => {
    const renamed = compareIndexInventory([expected()], {
      orders: [actual({ name: 'renamed_order_number' })],
    });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.renamed.length, 1);

    const payment = compareIndexInventory(
      [
        expected({
          name: 'payment_trxid_unique',
          key: { 'payment.claims.trxIdNormalized': 1 },
          requireExactName: true,
          partialFilterExpression: {
            'payment.claims.trxIdNormalized': { $type: 'string' },
          },
        }),
      ],
      {
        orders: [
          actual({
            name: 'renamed_payment_index',
            key: { 'payment.claims.trxIdNormalized': 1 },
            partialFilterExpression: {
              'payment.claims.trxIdNormalized': { $type: 'string' },
            },
          }),
        ],
      },
    );
    assert.equal(payment.ok, false);
    assert.equal(payment.mismatched.length, 1);
  });

  it('understands MongoDB text-index _fts keys and weights', () => {
    const textExpected = expected({
      collection: 'products',
      name: 'name_text_description_text',
      key: { name: 'text', description: 'text' },
      unique: false,
      textFields: ['name', 'description'],
    });
    const textActual = actual({
      name: 'name_text_description_text',
      key: { _fts: 'text', _ftsx: 1 },
      unique: false,
      weights: { name: 1, description: 1 },
    });
    const result = compareIndexInventory([textExpected], { products: [textActual] });
    assert.equal(result.ok, true);
  });

  it('ignores the MongoDB _id index', () => {
    const result = compareIndexInventory([expected()], {
      orders: [actual(), actual({ name: '_id_', key: { _id: 1 }, unique: false })],
    });
    assert.equal(result.ok, true);
    assert.equal(result.extras.length, 0);
  });
});
