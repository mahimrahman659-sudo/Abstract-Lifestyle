import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { readDeploymentCapabilities } from '../src/config/mongo-capabilities.js';
import { AppError } from '../src/middleware/error-handler.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { NotificationModel } from '../src/models/notification.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { addItem } from '../src/services/cart.service.js';
import { adminListOrders, adminUpdateOrderStatus } from '../src/services/admin-order.service.js';
import {
  completeManualRefund,
  reviewManualPayment,
  submitManualPayment,
} from '../src/services/payment-claim.service.js';
import { cancelOrder, createOrder, getOrder } from '../src/services/order.service.js';
import {
  dispatchPendingNotifications,
  enqueueNotification,
} from '../src/services/notification.service.js';
import { signAuthToken } from '../src/utils/jwt.js';
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

interface Fixture {
  user: UserDocument;
  product: Types.ObjectId;
  variant: Types.ObjectId;
  sku: string;
}

const makeFixture = async (
  role: 'customer' | 'admin' = 'customer',
  stock = 10,
): Promise<Fixture> => {
  const tag = unique('p2');
  const user = await UserModel.create({
    email: `${tag}@example.com`,
    name: 'P2 Test User',
    role,
  });
  const category = await CategoryModel.create({ name: `Cat ${tag}`, slug: `cat-${tag}` });
  const product = await ProductModel.create({
    name: `Product ${tag}`,
    slug: `product-${tag}`,
    description: 'Fixture product for Phase 2 manual payment tests.',
    category: category._id,
    basePrice: 10000,
    images: [],
    status: 'active',
  });
  const sku = `SKU-${tag}`;
  const variant = await VariantModel.create({
    product: product._id,
    sku,
    size: 'M',
    color: null,
    price: null,
    stock,
    lowStockThreshold: 5,
    images: [],
  });
  return { user, product: product._id, variant: variant._id, sku: variant.sku };
};

const addCartItem = async (fixture: Fixture, quantity = 1): Promise<void> => {
  await addItem(fixture.user._id, fixture.variant.toString(), quantity);
};

const placeOrder = async (
  fixture: Fixture,
  paymentMethod: 'cod' | 'bkash' | 'nagad' | 'rocket' = 'bkash',
) =>
  createOrder(fixture.user, {
    checkoutId: randomUUID(),
    paymentMethod,
    shippingAddress: {
      fullName: 'P2 Test User',
      phone: '01700000000',
      line1: 'House 1, Road 1',
      isDefault: true,
    },
  });

const stockOf = async (variantId: Types.ObjectId): Promise<number | null> => {
  const variant = await VariantModel.findById(variantId).select('stock').lean().exec();
  return variant ? variant.stock : null;
};

const storedOrder = async (orderId: string) => {
  const order = await OrderModel.findById(orderId).exec();
  assert.ok(order);
  return order;
};

const claimIdOf = async (orderId: string): Promise<string> => {
  const order = await storedOrder(orderId);
  const claim = order.payment?.claims.find((item) => item.status === 'pending_verification');
  assert.ok(claim?._id, 'pending claim exists');
  return claim._id.toString();
};

const waitForSentNotification = async (orderId: string) => {
  let notification = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    notification = await NotificationModel.findOne({
      order: new Types.ObjectId(orderId),
      type: 'payment_submitted',
    }).exec();
    if (notification?.status === 'sent') {
      return notification;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return notification;
};

let paidSequence = 0;
const makePaidCancelledOrder = async (
  method: 'bkash' | 'nagad' | 'rocket' = 'bkash',
): Promise<{ fixture: Fixture; admin: Fixture; orderId: string; total: number }> => {
  const fixture = await makeFixture();
  const admin = await makeFixture('admin');
  await addCartItem(fixture, 1);
  const order = await placeOrder(fixture, method);
  paidSequence += 1;
  await submitManualPayment(fixture.user, order.id, {
    senderNumber: '01712345678',
    trxId: `PAID${paidSequence.toString().padStart(8, '0')}`,
  });
  await reviewManualPayment(admin.user, order.id, {
    claimId: await claimIdOf(order.id),
    decision: 'paid',
  });
  await cancelOrder(fixture.user, order.id);
  return { fixture, admin, orderId: order.id, total: order.total };
};

describe('Phase 2 — manual MFS payments (integration)', () => {
  let server: Server | undefined;
  let origin: string;
  const savedEnv = {
    bkash: env.BKASH_PAYMENT_ENABLED,
    bkashNumber: env.BKASH_PAYMENT_NUMBER,
    nagad: env.NAGAD_PAYMENT_ENABLED,
    nagadNumber: env.NAGAD_PAYMENT_NUMBER,
    rocket: env.ROCKET_PAYMENT_ENABLED,
    rocketNumber: env.ROCKET_PAYMENT_NUMBER,
  };

  before(async () => {
    await connectTestDatabase();
    const db = mongoose.connection.db;
    assert.ok(db);
    const capabilities = await readDeploymentCapabilities(db);
    assert.equal(
      capabilities.transactions,
      true,
      `test database must be a replica set (${capabilities.detail})`,
    );

    await Promise.all([
      UserModel.syncIndexes(),
      CategoryModel.syncIndexes(),
      ProductModel.syncIndexes(),
      VariantModel.syncIndexes(),
      CartModel.syncIndexes(),
      OrderModel.syncIndexes(),
      NotificationModel.syncIndexes(),
    ]);

    env.BKASH_PAYMENT_ENABLED = true;
    env.BKASH_PAYMENT_NUMBER = '01711111111';
    env.NAGAD_PAYMENT_ENABLED = true;
    env.NAGAD_PAYMENT_NUMBER = '01722222222';
    env.ROCKET_PAYMENT_ENABLED = true;
    env.ROCKET_PAYMENT_NUMBER = '017333333333';

    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase();
    env.BKASH_PAYMENT_ENABLED = true;
    env.BKASH_PAYMENT_NUMBER = '01711111111';
    env.NAGAD_PAYMENT_ENABLED = true;
    env.NAGAD_PAYMENT_NUMBER = '01722222222';
    env.ROCKET_PAYMENT_ENABLED = true;
    env.ROCKET_PAYMENT_NUMBER = '017333333333';
  });

  after(async () => {
    env.BKASH_PAYMENT_ENABLED = savedEnv.bkash;
    env.BKASH_PAYMENT_NUMBER = savedEnv.bkashNumber;
    env.NAGAD_PAYMENT_ENABLED = savedEnv.nagad;
    env.NAGAD_PAYMENT_NUMBER = savedEnv.nagadNumber;
    env.ROCKET_PAYMENT_ENABLED = savedEnv.rocket;
    env.ROCKET_PAYMENT_NUMBER = savedEnv.rocketNumber;
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectTestDatabase();
  });

  const request = (
    user: UserDocument | null,
    path: string,
    method: string,
    body?: unknown,
  ) =>
    fetch(`${origin}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Cookie: `al_token=${signAuthToken(user._id.toString(), user.role)}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  describe('order creation and configuration', () => {
    it('creates an awaiting-payment manual order and reserves stock once', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 2);
      const order = await placeOrder(fixture, 'bkash');

      assert.equal(order.paymentMethod, 'bkash');
      assert.equal(order.paymentStatus, 'awaiting_payment');
      assert.equal(order.payment.provider, 'manual');
      assert.equal(order.payment.senderNumber, null);
      assert.equal(order.payment.claims.length, 0);
      assert.equal(await stockOf(fixture.variant), 8);
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 0);
    });

    it('replays the same checkoutId without a second stock decrement', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const checkoutId = randomUUID();
      const input = {
        checkoutId,
        paymentMethod: 'nagad' as const,
        shippingAddress: {
          fullName: 'P2 Test User',
          phone: '01700000000',
          line1: 'House 1',
          isDefault: true,
        },
      };
      const first = await createOrder(fixture.user, input);
      await addCartItem(fixture, 1);
      const second = await createOrder(fixture.user, input);
      assert.equal(second.id, first.id);
      assert.equal(await stockOf(fixture.variant), 9);
      assert.equal(await OrderModel.countDocuments({ user: fixture.user._id }), 1);
    });

    it('rejects a disabled provider before claiming the cart or decrementing stock', async () => {
      env.BKASH_PAYMENT_ENABLED = false;
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      await assert.rejects(placeOrder(fixture, 'bkash'), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'PAYMENT_METHOD_UNAVAILABLE');
        assert.equal(error.statusCode, 409);
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 10);
      assert.equal(await OrderModel.countDocuments(), 0);
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1);
      assert.equal(cart?.checkoutInProgress, null);
    });

    it('returns enabled public methods only and never leaks disabled numbers', async () => {
      env.NAGAD_PAYMENT_ENABLED = false;
      const response = await request(null, '/payments/methods', 'GET');
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        methods: Array<{
          method: string;
          enabled: boolean;
          receivingNumber: string | null;
        }>;
      };
      const nagad = body.methods.find((method) => method.method === 'nagad');
      const bkash = body.methods.find((method) => method.method === 'bkash');
      assert.equal(nagad?.enabled, false);
      assert.equal(nagad?.receivingNumber, null);
      assert.equal(bkash?.enabled, true);
      assert.equal(bkash?.receivingNumber, '01711111111');
    });
  });

  describe('proof submission', () => {
    for (const method of ['bkash', 'nagad', 'rocket'] as const) {
      it(`accepts a valid ${method} sender and transaction reference`, async () => {
        const fixture = await makeFixture();
        await addCartItem(fixture, 1);
        const order = await placeOrder(fixture, method);
        const updated = await submitManualPayment(fixture.user, order.id, {
          senderNumber: '+880 1712-345678',
          trxId: ' ab12cd ',
        });
        assert.equal(updated.paymentStatus, 'pending_verification');
        assert.equal(updated.payment.senderNumber, '01712345678');
        assert.equal(updated.payment.trxId, 'AB12CD');
        assert.equal(updated.payment.claims.length, 1);
        assert.equal(updated.payment.claims[0]?.status, 'pending_verification');

        assert.equal(
          await NotificationModel.countDocuments({
            order: new Types.ObjectId(order.id),
            type: 'payment_submitted',
          }),
          1,
        );
        await dispatchPendingNotifications();
        const notification = await waitForSentNotification(order.id);
        assert.equal(notification?.status, 'sent');
      });
    }

    it('is idempotent for the exact same claim while pending', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      const input = { senderNumber: '01712345678', trxId: 'SAME1234' };
      const first = await submitManualPayment(fixture.user, order.id, input);
      const second = await submitManualPayment(fixture.user, order.id, input);
      assert.equal(second.paymentStatus, 'pending_verification');
      assert.equal(second.payment.claims.length, 1);
      assert.equal(first.payment.claims.length, 1);
    });

    it('locks a pending claim against different details', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'FIRST123',
      });
      await assert.rejects(
        submitManualPayment(fixture.user, order.id, {
          senderNumber: '01712345678',
          trxId: 'SECOND12',
        }),
        (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_CLAIM_LOCKED',
      );
    });

    it('rejects invalid sender numbers and transaction ids', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      await assert.rejects(
        submitManualPayment(fixture.user, order.id, {
          senderNumber: '123',
          trxId: 'AB12CD',
        }),
      );
      await assert.rejects(
        submitManualPayment(fixture.user, order.id, {
          senderNumber: '01712345678',
          trxId: 'ab-12',
        }),
      );
      assert.equal((await storedOrder(order.id)).paymentStatus, 'awaiting_payment');
    });

    it('enforces order ownership', async () => {
      const owner = await makeFixture();
      const other = await makeFixture();
      await addCartItem(owner, 1);
      const order = await placeOrder(owner, 'bkash');
      await assert.rejects(
        submitManualPayment(other.user, order.id, {
          senderNumber: '01712345678',
          trxId: 'OWNER123',
        }),
        (error: unknown) => error instanceof AppError && error.statusCode === 404,
      );
    });

    it('rejects duplicate TrxIDs across orders and methods', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const first = await placeOrder(fixture, 'bkash');
      await submitManualPayment(fixture.user, first.id, {
        senderNumber: '01712345678',
        trxId: 'DUPLICATE1',
      });

      await addCartItem(fixture, 1);
      const second = await placeOrder(fixture, 'nagad');
      await assert.rejects(
        submitManualPayment(fixture.user, second.id, {
          senderNumber: '01712345678',
          trxId: 'duplicate1',
        }),
        (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_TRX_ID_USED',
      );
      assert.equal((await storedOrder(second.id)).paymentStatus, 'awaiting_payment');
    });

    it('serialises concurrent duplicate submissions and never writes two claims', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      const input = { senderNumber: '01712345678', trxId: 'RACE1234' };
      const results = await Promise.allSettled([
        submitManualPayment(fixture.user, order.id, input),
        submitManualPayment(fixture.user, order.id, input),
      ]);
      assert.ok(results.every((result) => result.status === 'fulfilled'));
      const stored = await storedOrder(order.id);
      assert.equal(stored.paymentStatus, 'pending_verification');
      assert.equal(stored.payment?.claims.length, 1);
    });

    it('rejects the same TrxID submitted concurrently to two different orders', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const first = await placeOrder(fixture, 'bkash');
      await addCartItem(fixture, 1);
      const second = await placeOrder(fixture, 'nagad');

      const results = await Promise.allSettled([
        submitManualPayment(fixture.user, first.id, {
          senderNumber: '01712345678',
          trxId: 'CROSSRACE1',
        }),
        submitManualPayment(fixture.user, second.id, {
          senderNumber: '01712345678',
          trxId: 'crossrace1',
        }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(rejected && rejected.status === 'rejected');
      assert.ok(rejected.reason instanceof AppError);
      assert.equal(rejected.reason.code, 'PAYMENT_TRX_ID_USED');
      assert.equal(
        await OrderModel.countDocuments({
          'payment.claims.trxIdNormalized': 'CROSSRACE1',
        }),
        1,
      );
    });

    it('allows one winner when concurrent submissions carry different TrxIDs', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      const results = await Promise.allSettled([
        submitManualPayment(fixture.user, order.id, {
          senderNumber: '01712345678',
          trxId: 'RACEAAAA',
        }),
        submitManualPayment(fixture.user, order.id, {
          senderNumber: '01712345678',
          trxId: 'RACEBBBB',
        }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      assert.equal((await storedOrder(order.id)).payment?.claims.length, 1);
    });
  });

  describe('admin verification and authorization', () => {
    it('restricts the review endpoint to admins and exposes the audit trail', async () => {
      const customer = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(customer, 1);
      const order = await placeOrder(customer, 'bkash');
      await submitManualPayment(customer.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'ADMIN123',
      });
      const claimId = await claimIdOf(order.id);

      assert.equal(
        (await request(customer.user, `/admin/orders/${order.id}/payment`, 'PATCH', {
          claimId,
          decision: 'paid',
        })).status,
        403,
      );

      const approved = await request(admin.user, `/admin/orders/${order.id}/payment`, 'PATCH', {
        claimId,
        decision: 'paid',
      });
      assert.equal(approved.status, 200);
      const body = (await approved.json()) as {
        order: {
          paymentStatus: string;
          payment: {
            claims: Array<{ status: string; reviewedBy: string | null }>;
            verificationHistory: Array<{
              action: string;
              by: string | null;
              actor: string | null;
            }>;
          };
        };
      };
      assert.equal(body.order.paymentStatus, 'paid');
      assert.equal(body.order.payment.claims[0]?.status, 'approved');
      assert.equal(body.order.payment.claims[0]?.reviewedBy, admin.user._id.toString());
      const submittedEntry = body.order.payment.verificationHistory.find(
        (entry) => entry.action === 'submitted',
      );
      const approvedEntry = body.order.payment.verificationHistory.find(
        (entry) => entry.action === 'approved',
      );
      assert.equal(submittedEntry?.actor, 'customer');
      assert.equal(approvedEntry?.actor, 'admin');
      assert.equal(approvedEntry?.by, admin.user._id.toString());
    });

    it('requires a rejection reason and allows a controlled resubmission', async () => {
      const customer = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(customer, 1);
      const order = await placeOrder(customer, 'rocket');
      await submitManualPayment(customer.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'REJECT12',
      });
      const claimId = await claimIdOf(order.id);

      const withoutReason = await request(
        admin.user,
        `/admin/orders/${order.id}/payment`,
        'PATCH',
        { claimId, decision: 'rejected' },
      );
      assert.equal(withoutReason.status, 400);

      const rejected = await request(admin.user, `/admin/orders/${order.id}/payment`, 'PATCH', {
        claimId,
        decision: 'rejected',
        rejectionReason: 'Transaction not found in the receiving account',
      });
      assert.equal(rejected.status, 200);
      assert.equal((await storedOrder(order.id)).paymentStatus, 'rejected');
      await dispatchPendingNotifications();
      assert.equal(
        await NotificationModel.countDocuments({
          order: new Types.ObjectId(order.id),
          type: 'payment_rejected',
        }),
        1,
      );

      const resubmitted = await submitManualPayment(customer.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'RESUBMIT1',
      });
      assert.equal(resubmitted.paymentStatus, 'pending_verification');
      assert.equal(resubmitted.payment.claims.length, 2);
      assert.equal(resubmitted.payment.claims[0]?.status, 'rejected');
      assert.equal(resubmitted.payment.claims[1]?.status, 'pending_verification');

      await addCartItem(customer, 1);
      const other = await placeOrder(customer, 'bkash');
      await assert.rejects(
        submitManualPayment(customer.user, other.id, {
          senderNumber: '01712345678',
          trxId: 'REJECT12',
        }),
        (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_TRX_ID_USED',
      );
    });

    it('lets only one competing admin decide the same claim', async () => {
      const customer = await makeFixture();
      const adminA = await makeFixture('admin');
      const adminB = await makeFixture('admin');
      await addCartItem(customer, 1);
      const order = await placeOrder(customer, 'bkash');
      await submitManualPayment(customer.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'COMPETE1',
      });
      const claimId = await claimIdOf(order.id);

      const [approve, reject] = await Promise.all([
        request(adminA.user, `/admin/orders/${order.id}/payment`, 'PATCH', {
          claimId,
          decision: 'paid',
        }),
        request(adminB.user, `/admin/orders/${order.id}/payment`, 'PATCH', {
          claimId,
          decision: 'rejected',
          rejectionReason: 'Received account does not match',
        }),
      ]);
      const statuses = [approve.status, reject.status].sort((a, b) => a - b);
      assert.deepEqual(statuses, [200, 409]);

      const stored = await storedOrder(order.id);
      assert.ok(['paid', 'rejected'].includes(stored.paymentStatus));
      const approved = stored.payment?.verificationHistory.filter(
        (entry) => entry.action === 'approved',
      ).length;
      const rejected = stored.payment?.verificationHistory.filter(
        (entry) => entry.action === 'rejected',
      ).length;
      assert.equal((approved ?? 0) + (rejected ?? 0), 1);
      assert.equal(stored.payment?.claims[0]?.status === 'pending_verification', false);
    });

    it('filters the pending-payment queue by method and status', async () => {
      const customer = await makeFixture();
      await addCartItem(customer, 1);
      const bkashOrder = await placeOrder(customer, 'bkash');
      await submitManualPayment(customer.user, bkashOrder.id, {
        senderNumber: '01712345678',
        trxId: 'QUEUE123',
      });
      await addCartItem(customer, 1);
      await placeOrder(customer, 'nagad');

      const queue = await adminListOrders({
        paymentStatus: 'pending_verification',
        paymentMethod: 'bkash',
        page: 1,
        limit: 10,
      });
      assert.equal(queue.total, 1);
      assert.equal(queue.items[0]?.id, bkashOrder.id);
    });
  });

  describe('cancellation, refunds and fulfilment guards', () => {
    it('refuses to cancel a claim under verification', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'PEND1234',
      });
      await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'PAYMENT_REVIEW_IN_PROGRESS');
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 9);
      assert.equal((await storedOrder(order.id)).paymentStatus, 'pending_verification');
    });

    it('marks a cancelled paid order refund_pending instead of refunded', async () => {
      const fixture = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'nagad');
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'PAID1234',
      });
      await reviewManualPayment(admin.user, order.id, {
        claimId: await claimIdOf(order.id),
        decision: 'paid',
      });

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.paymentStatus, 'refund_pending');
      assert.equal(await stockOf(fixture.variant), 10);
      await dispatchPendingNotifications();
      assert.equal(
        await NotificationModel.countDocuments({
          order: new Types.ObjectId(order.id),
          type: 'payment_refund_pending',
        }),
        1,
      );

      const refunded = await completeManualRefund(admin.user, order.id, {
        refundReference: 'NAGADREF1',
        refundAmount: order.total,
        refundRecipient: '01712345678',
        confirmed: true,
        note: 'Verified in the provider refund record',
      });
      assert.equal(refunded.paymentStatus, 'refunded');
      assert.equal(refunded.payment.refundReference, 'NAGADREF1');
      assert.equal(refunded.payment.refundAmount, order.total);
      assert.equal(refunded.payment.refundRecipient, '01712345678');
      assert.equal(refunded.payment.refundedBy, admin.user._id.toString());
      assert.ok(refunded.payment.refundedAt);
      const stored = await storedOrder(order.id);
      assert.equal(stored.payment?.claims.length, 1);
      assert.equal(stored.payment?.refundReference, 'NAGADREF1');
      assert.equal(
        stored.payment?.verificationHistory.some(
          (entry) =>
            entry.action === 'refunded' &&
            entry.actor === 'admin' &&
            entry.refundReference === 'NAGADREF1' &&
            entry.refundAmount === order.total,
        ),
        true,
      );
      await dispatchPendingNotifications();
      assert.equal(
        await NotificationModel.countDocuments({
          order: new Types.ObjectId(order.id),
          type: 'payment_refunded',
        }),
        1,
      );
    });

    it('requires complete, matching refund evidence and is idempotent only for identical evidence', async () => {
      const { admin, orderId, total } = await makePaidCancelledOrder();
      const path = `/admin/orders/${orderId}/payment/refund`;
      const base = {
        refundReference: 'REFUND-9001',
        refundAmount: total,
        refundRecipient: '01712345678',
        confirmed: true,
      };

      assert.equal((await request(admin.user, path, 'PATCH', {})).status, 400);
      assert.equal(
        (await request(admin.user, path, 'PATCH', { ...base, refundReference: '' })).status,
        400,
      );
      assert.equal(
        (await request(admin.user, path, 'PATCH', { ...base, refundAmount: total - 1 })).status,
        400,
      );
      assert.equal(
        (await request(admin.user, path, 'PATCH', { ...base, refundRecipient: '01799999999' }))
          .status,
        400,
      );
      assert.equal(
        (await request(admin.user, path, 'PATCH', { ...base, confirmed: false })).status,
        400,
      );

      const first = await request(admin.user, path, 'PATCH', base);
      assert.equal(first.status, 200);
      const firstBody = (await first.json()) as { order: { paymentStatus: string } };
      assert.equal(firstBody.order.paymentStatus, 'refunded');

      const retry = await request(admin.user, path, 'PATCH', base);
      assert.equal(retry.status, 200, 'identical evidence retry is idempotent');

      const conflicting = await request(admin.user, path, 'PATCH', {
        ...base,
        refundReference: 'REFUND-9002',
      });
      assert.equal(conflicting.status, 409);
      const stored = await storedOrder(orderId);
      assert.equal(stored.payment?.refundReference, 'REFUND-9001');
      assert.equal(
        stored.payment?.verificationHistory.filter((entry) => entry.action === 'refunded').length,
        1,
      );
    });

    it('lets only one competing admin complete a refund with different evidence', async () => {
      const { admin, orderId, total } = await makePaidCancelledOrder('rocket');
      const adminB = await makeFixture('admin');
      const path = `/admin/orders/${orderId}/payment/refund`;
      const evidenceA = {
        refundReference: 'REFUND-A1',
        refundAmount: total,
        refundRecipient: '01712345678',
        confirmed: true,
      };
      const evidenceB = {
        refundReference: 'REFUND-B1',
        refundAmount: total,
        refundRecipient: '01712345678',
        confirmed: true,
      };

      const [a, b] = await Promise.all([
        request(admin.user, path, 'PATCH', evidenceA),
        request(adminB.user, path, 'PATCH', evidenceB),
      ]);
      assert.deepEqual([a.status, b.status].sort((x, y) => x - y), [200, 409]);
      const stored = await storedOrder(orderId);
      assert.ok(['REFUND-A1', 'REFUND-B1'].includes(stored.payment?.refundReference ?? ''));
      assert.equal(
        stored.payment?.verificationHistory.filter((entry) => entry.action === 'refunded').length,
        1,
      );
    });

    it('keeps a completed refund when notification dispatch fails', async (t) => {
      const { admin, orderId, total } = await makePaidCancelledOrder('nagad');
      t.mock.method(
        NotificationModel,
        'findOneAndUpdate',
        (() => ({
          exec: async () => {
            throw new Error('injected notification dispatch failure');
          },
        })) as unknown as typeof NotificationModel.findOneAndUpdate,
      );
      const refunded = await completeManualRefund(admin.user, orderId, {
        refundReference: 'REF-FAIL-1',
        refundAmount: total,
        refundRecipient: '01712345678',
        confirmed: true,
      });
      assert.equal(refunded.paymentStatus, 'refunded');
      const queued = await NotificationModel.findOne({
        order: new Types.ObjectId(orderId),
        type: 'payment_refunded',
      });
      assert.ok(queued, 'refund notification was durably enqueued despite dispatch failure');
      assert.equal((await storedOrder(orderId)).paymentStatus, 'refunded');
    });

    it('keeps COD cancellation unchanged', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'cod');
      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.paymentStatus, 'unpaid');
      assert.equal(await stockOf(fixture.variant), 10);
      assert.equal((await storedOrder(order.id)).stockRestored, true);
    });

    it('blocks delivering a prepaid order whose payment is not verified', async () => {
      const fixture = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      await OrderModel.updateOne({ _id: order.id }, { $set: { status: 'shipped' } });
      await assert.rejects(
        adminUpdateOrderStatus(admin.user, order.id, { status: 'delivered' }),
        (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_NOT_CONFIRMED',
      );
      assert.equal((await storedOrder(order.id)).status, 'shipped');
    });

    it('blocks processing and shipping until the manual payment is verified', async () => {
      const fixture = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');

      await assert.rejects(
        adminUpdateOrderStatus(admin.user, order.id, { status: 'processing' }),
        (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_NOT_CONFIRMED',
      );
      await OrderModel.updateOne({ _id: order.id }, { $set: { status: 'processing' } });
      await assert.rejects(
        adminUpdateOrderStatus(admin.user, order.id, { status: 'shipped' }),
        (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_NOT_CONFIRMED',
      );
      assert.equal((await storedOrder(order.id)).status, 'processing');

      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'VERIFY12',
      });
      await reviewManualPayment(admin.user, order.id, {
        claimId: await claimIdOf(order.id),
        decision: 'paid',
      });
      const shipped = await adminUpdateOrderStatus(admin.user, order.id, { status: 'shipped' });
      assert.equal(shipped.status, 'shipped');
    });

    it('lets an admin cancel a paid prepaid order into refund_pending', async () => {
      const fixture = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'rocket');
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'ADMINCAN1',
      });
      await reviewManualPayment(admin.user, order.id, {
        claimId: await claimIdOf(order.id),
        decision: 'paid',
      });

      const cancelled = await adminUpdateOrderStatus(admin.user, order.id, {
        status: 'cancelled',
      });
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.paymentStatus, 'refund_pending');
      assert.equal(await stockOf(fixture.variant), 10);
      await dispatchPendingNotifications();
      assert.equal(
        await NotificationModel.countDocuments({
          order: new Types.ObjectId(order.id),
          type: 'payment_refund_pending',
        }),
        1,
      );
    });

    it('blocks admin cancellation of a claim under verification', async () => {
      const fixture = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'ADMINPEND',
      });
      await assert.rejects(
        adminUpdateOrderStatus(admin.user, order.id, { status: 'cancelled' }),
        (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_REVIEW_IN_PROGRESS',
      );
      assert.equal((await storedOrder(order.id)).status, 'pending');
    });

    it('keeps COD delivery marking payment paid', async () => {
      const fixture = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'cod');
      await OrderModel.updateOne({ _id: order.id }, { $set: { status: 'shipped' } });
      const delivered = await adminUpdateOrderStatus(admin.user, order.id, {
        status: 'delivered',
      });
      assert.equal(delivered.paymentStatus, 'paid');
    });
  });

  describe('rollback, indexes and notifications', () => {
    it('rolls stock and cart back when manual order creation fails', async () => {
      const fixture = await makeFixture();
      await addCartItem(fixture, 2);
      type CreateFn = typeof OrderModel.create;
      const original = OrderModel.create.bind(OrderModel);
      (OrderModel as unknown as { create: CreateFn }).create = (() => {
        throw new Error('forced manual order insert failure');
      }) as unknown as CreateFn;
      try {
        await assert.rejects(placeOrder(fixture, 'bkash'), /forced manual order insert failure/);
      } finally {
        (OrderModel as unknown as { create: CreateFn }).create = original as unknown as CreateFn;
      }
      assert.equal(await stockOf(fixture.variant), 10);
      assert.equal(await OrderModel.countDocuments(), 0);
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1);
      assert.equal(cart?.checkoutInProgress, null);
    });

    it('creates the partial unique TrxID index', async () => {
      const indexes = await OrderModel.collection.indexes();
      const index = indexes.find((item) => item.name === 'payment_trxid_unique');
      assert.ok(index);
      assert.equal(index.unique, true);
      assert.deepEqual(index.key, { 'payment.claims.trxIdNormalized': 1 });
      assert.deepEqual(index.partialFilterExpression, {
        'payment.claims.trxIdNormalized': { $type: 'string' },
      });
    });

    it('processes outbox rows idempotently under concurrent dispatchers', async () => {
      const fixture = await makeFixture();
      const orderId = new Types.ObjectId();
      for (let index = 0; index < 5; index += 1) {
        await enqueueNotification({
          user: fixture.user._id,
          order: orderId,
          orderNumber: `AL-NOTIFY-${index}`,
          type: 'payment_submitted',
          message: `Outbox concurrency message ${index}`,
        });
      }

      const results = await Promise.all([
        dispatchPendingNotifications(),
        dispatchPendingNotifications(),
      ]);
      assert.equal(results[0]?.failed, 0);
      assert.equal(results[1]?.failed, 0);

      const rows = await NotificationModel.find({ order: orderId }).exec();
      assert.equal(rows.length, 5);
      for (const row of rows) {
        assert.equal(row.status, 'sent');
        assert.equal(row.attempts, 1);
        assert.equal(row.lockedAt, null);
        assert.equal(row.lockId, null);
      }
    });

    it('lists payment notifications only for their owner', async () => {
      const fixture = await makeFixture();
      const other = await makeFixture();
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'NOTIFY12',
      });
      await dispatchPendingNotifications();

      const own = await request(fixture.user, '/notifications', 'GET');
      assert.equal(own.status, 200);
      const ownBody = (await own.json()) as { items: Array<{ orderId: string }> };
      assert.equal(ownBody.items.length, 1);
      assert.equal(ownBody.items[0]?.orderId, order.id);

      const otherResponse = await request(other.user, '/notifications', 'GET');
      const otherBody = (await otherResponse.json()) as { items: unknown[] };
      assert.equal(otherBody.items.length, 0);

      assert.equal((await request(null, '/notifications', 'GET')).status, 401);
    });

    it('keeps the paid state even when notification delivery is not run', async () => {
      const fixture = await makeFixture();
      const admin = await makeFixture('admin');
      await addCartItem(fixture, 1);
      const order = await placeOrder(fixture, 'bkash');
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: 'OUTBOX12',
      });
      const reviewed = await reviewManualPayment(admin.user, order.id, {
        claimId: await claimIdOf(order.id),
        decision: 'paid',
      });
      assert.equal(reviewed.paymentStatus, 'paid');
      const queued = await NotificationModel.findOne({
        order: new Types.ObjectId(order.id),
        type: 'payment_submitted',
      });
      assert.ok(queued, 'outbox row exists independently of the committed payment state');
      assert.equal((await getOrder(fixture.user, order.id)).paymentStatus, 'paid');
    });
  });
});
