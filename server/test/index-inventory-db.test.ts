import './setup-env.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { readIndexInventory } from '../src/config/index-inventory.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { NotificationModel } from '../src/models/notification.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { SiteImageModel } from '../src/models/site-image.model.js';
import { UserModel } from '../src/models/user.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';

describe('index inventory — disposable database', () => {
  before(async () => {
    await connectTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await Promise.all([
      UserModel.syncIndexes(),
      CartModel.syncIndexes(),
      CategoryModel.syncIndexes(),
      ProductModel.syncIndexes(),
      VariantModel.syncIndexes(),
      SiteImageModel.syncIndexes(),
      OrderModel.syncIndexes(),
      NotificationModel.syncIndexes(),
    ]);
  });

  after(async () => {
    await disconnectTestDatabase();
  });

  const inventory = async () => {
    const db = mongoose.connection.db;
    assert.ok(db);
    return readIndexInventory(db);
  };

  it('reports every expected critical index as present', async () => {
    const result = await inventory();
    assert.equal(result.ok, true, JSON.stringify(result.missing));
    assert.equal(result.missing.length, 0);
    assert.equal(result.mismatched.length, 0);
    assert.equal(result.extras.length, 0);
  });

  it('reports a missing non-unique index and recovers after syncIndexes', async () => {
    await OrderModel.collection.dropIndex('paymentStatus_1_createdAt_-1');
    const missing = await inventory();
    assert.equal(missing.ok, false);
    assert.ok(
      missing.missing.some(
        (item) =>
          item.collection === OrderModel.collection.name &&
          item.name === 'paymentStatus_1_createdAt_-1',
      ),
    );

    await OrderModel.syncIndexes();
    const recovered = await inventory();
    assert.equal(recovered.ok, true);
  });

  it('reports an incorrectly configured payment index and recovers', async () => {
    await OrderModel.collection.dropIndex('payment_trxid_unique');
    await OrderModel.collection.createIndex(
      { 'payment.claims.trxIdNormalized': 1 },
      {
        name: 'payment_trxid_unique',
        unique: false,
        partialFilterExpression: {
          'payment.claims.trxIdNormalized': { $type: 'string' },
        },
      },
    );
    const wrong = await inventory();
    assert.equal(wrong.ok, false);
    assert.ok(
      wrong.mismatched.some(
        (item) => item.expected.name === 'payment_trxid_unique' && item.reason === 'unique',
      ),
    );

    await OrderModel.syncIndexes();
    const recovered = await inventory();
    assert.equal(recovered.ok, true);
  });
});
