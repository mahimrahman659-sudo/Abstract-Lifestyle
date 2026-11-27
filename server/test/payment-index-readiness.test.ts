import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import {
  assertPaymentIndexReadyForManualOperations,
  getPaymentIndexReadiness,
  PAYMENT_TRXID_INDEX_KEY,
  PAYMENT_TRXID_INDEX_NAME,
  PAYMENT_TRXID_INDEX_PARTIAL,
} from '../src/config/payment-index.js';
import { env } from '../src/config/env.js';
import { readDeploymentCapabilities } from '../src/config/mongo-capabilities.js';
import { AppError } from '../src/middleware/error-handler.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { addItem } from '../src/services/cart.service.js';
import { createOrder } from '../src/services/order.service.js';
import { submitManualPayment } from '../src/services/payment-claim.service.js';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';

let sequence = 0;
const unique = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

const setManualProviders = (enabled: boolean): void => {
  env.BKASH_PAYMENT_ENABLED = enabled;
  env.BKASH_PAYMENT_NUMBER = enabled ? '01711111111' : '';
  env.NAGAD_PAYMENT_ENABLED = false;
  env.NAGAD_PAYMENT_NUMBER = '';
  env.ROCKET_PAYMENT_ENABLED = false;
  env.ROCKET_PAYMENT_NUMBER = '';
};

const makeManualOrder = async (): Promise<{ user: UserDocument; orderId: string }> => {
  const tag = unique('idx');
  const user = await UserModel.create({
    email: `${tag}@example.com`,
    name: 'Index Test Customer',
    role: 'customer',
  });
  const order = await OrderModel.create({
    orderNumber: `AL-20261119-${tag.slice(-4).toUpperCase()}`,
    user: user._id,
    items: [
      {
        product: new Types.ObjectId(),
        variant: new Types.ObjectId(),
        name: 'Index Test Item',
        sku: `IDX-${tag}`,
        size: null,
        color: null,
        image: null,
        unitPrice: 10000,
        quantity: 1,
        lineTotal: 10000,
      },
    ],
    shippingAddress: {
      fullName: 'Index Test Customer',
      phone: '01712345678',
      line1: 'House 1',
    },
    paymentMethod: 'bkash',
    paymentStatus: 'awaiting_payment',
    payment: {
      provider: 'manual',
      senderNumber: null,
      trxId: null,
      trxIdNormalized: null,
      submittedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      rejectionReason: null,
      refundedBy: null,
      refundedAt: null,
      refundReference: null,
      refundAmount: null,
      refundRecipient: null,
      refundNote: null,
      claims: [],
      verificationHistory: [],
    },
    subtotal: 10000,
    shippingFee: 0,
    total: 10000,
    status: 'pending',
    statusHistory: [{ status: 'pending', at: new Date() }],
    stockRestored: false,
  });
  return { user, orderId: order._id.toString() };
};

const makeCodOrder = async (): Promise<void> => {
  const tag = unique('cod');
  const user = await UserModel.create({
    email: `${tag}@example.com`,
    name: 'COD Test Customer',
    role: 'customer',
  });
  const category = await CategoryModel.create({ name: `Cat ${tag}`, slug: `cat-${tag}` });
  const product = await ProductModel.create({
    name: `Product ${tag}`,
    slug: `product-${tag}`,
    description: 'COD fixture',
    category: category._id,
    basePrice: 10000,
    images: [],
    status: 'active',
  });
  const variant = await VariantModel.create({
    product: product._id,
    sku: `SKU-${tag}`,
    size: 'M',
    color: null,
    price: null,
    stock: 4,
    lowStockThreshold: 1,
    images: [],
  });
  await addItem(user._id, variant._id.toString(), 1);
  const order = await createOrder(user, {
    checkoutId: randomUUID(),
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'COD Test Customer',
      phone: '01712345678',
      line1: 'House 1',
      isDefault: true,
    },
  });
  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal((await VariantModel.findById(variant._id))?.stock, 3);
};

describe('H1 — payment index readiness', () => {
  before(async () => {
    await connectTestDatabase();
    const db = mongoose.connection.db;
    assert.ok(db);
    const capabilities = await readDeploymentCapabilities(db);
    assert.equal(capabilities.transactions, true);
    await resetTestDatabase();
    await Promise.all([
      UserModel.syncIndexes(),
      CategoryModel.syncIndexes(),
      ProductModel.syncIndexes(),
      VariantModel.syncIndexes(),
      CartModel.syncIndexes(),
      OrderModel.syncIndexes(),
    ]);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    setManualProviders(true);
    await OrderModel.syncIndexes();
  });

  after(async () => {
    setManualProviders(false);
    await disconnectTestDatabase();
  });

  it('reports a correctly configured index as ready', async () => {
    const readiness = await getPaymentIndexReadiness();
    assert.equal(readiness.required, true);
    assert.equal(readiness.ready, true, readiness.reason);
  });

  it('blocks manual claim writes when the index is missing', async () => {
    const { user, orderId } = await makeManualOrder();
    await OrderModel.collection.dropIndex(PAYMENT_TRXID_INDEX_NAME);

    const readiness = await getPaymentIndexReadiness();
    assert.equal(readiness.ready, false);
    await assert.rejects(
      assertPaymentIndexReadyForManualOperations(),
      (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_INDEX_UNAVAILABLE',
    );
    await assert.rejects(
      submitManualPayment(user, orderId, {
        senderNumber: '01712345678',
        trxId: 'BLOCK123',
      }),
      (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_INDEX_UNAVAILABLE',
    );
    assert.equal((await OrderModel.findById(orderId))?.paymentStatus, 'awaiting_payment');
  });

  it('blocks manual claim writes when the index definition is wrong', async () => {
    await OrderModel.collection.dropIndex(PAYMENT_TRXID_INDEX_NAME);
    await OrderModel.collection.createIndex(
      { 'payment.claims.trxIdNormalized': 1 },
      { name: PAYMENT_TRXID_INDEX_NAME, unique: false },
    );
    const readiness = await getPaymentIndexReadiness();
    assert.equal(readiness.ready, false);
    await assert.rejects(
      assertPaymentIndexReadyForManualOperations(),
      (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_INDEX_UNAVAILABLE',
    );
  });

  it('does not require the payment index for COD when every manual provider is disabled', async () => {
    setManualProviders(false);
    await OrderModel.collection.dropIndex(PAYMENT_TRXID_INDEX_NAME);
    await assert.doesNotReject(assertPaymentIndexReadyForManualOperations());
    await makeCodOrder();
  });

  it('detects duplicate historical data that prevents index creation', async () => {
    await OrderModel.collection.dropIndex(PAYMENT_TRXID_INDEX_NAME);
    await OrderModel.collection.insertMany([
      {
        orderNumber: unique('DUPA'),
        payment: { claims: [{ trxIdNormalized: 'DUPHIST1' }] },
      },
      {
        orderNumber: unique('DUPB'),
        payment: { claims: [{ trxIdNormalized: 'DUPHIST1' }] },
      },
    ]);

    await assert.rejects(
      OrderModel.collection.createIndex(
        PAYMENT_TRXID_INDEX_KEY,
        {
          name: PAYMENT_TRXID_INDEX_NAME,
          unique: true,
          partialFilterExpression: PAYMENT_TRXID_INDEX_PARTIAL,
        },
      ),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 11000,
    );
    const readiness = await getPaymentIndexReadiness();
    assert.equal(readiness.ready, false);
    await assert.rejects(
      assertPaymentIndexReadyForManualOperations(),
      (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_INDEX_UNAVAILABLE',
    );
  });

  it('fails closed after a database reconnection with the index missing', async () => {
    assert.equal((await getPaymentIndexReadiness()).ready, true);
    await OrderModel.collection.dropIndex(PAYMENT_TRXID_INDEX_NAME);
    await disconnectTestDatabase();
    await connectTestDatabase();

    const readiness = await getPaymentIndexReadiness();
    assert.equal(readiness.required, true);
    assert.equal(readiness.ready, false);
    await assert.rejects(
      assertPaymentIndexReadyForManualOperations(),
      (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_INDEX_UNAVAILABLE',
    );
  });
});
