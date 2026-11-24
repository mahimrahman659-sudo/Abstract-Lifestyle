import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { NotificationModel } from '../src/models/notification.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { ActivityEventModel } from '../src/models/activity-event.model.js';
import { addItem, clearCart, removeItem, updateItem } from '../src/services/cart.service.js';
import { adminUpdateOrderStatus } from '../src/services/admin-order.service.js';
import {
  completeManualRefund,
  reviewManualPayment,
  submitManualPayment,
} from '../src/services/payment-claim.service.js';
import { cancelOrder, createOrder } from '../src/services/order.service.js';
import { adminGetCustomer } from '../src/services/admin-customer.service.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { deterministicEventId } from '../src/utils/event-id.js';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';

/**
 * Phase 1B-B/C — backend-authoritative commerce events.
 *
 * Invariants verified here:
 * - events fire only after successful business operations (never on throws);
 * - deterministic ids make retries idempotent;
 * - analytics failure can never block checkout/payment/cancellation;
 * - no payment references or PII ever reach the event store;
 * - flag off ⇒ zero event writes;
 * - customer detail views are audited (`admin.customer_viewed`).
 */

let sequence = 0;
const unique = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

const setManual = (enabled: boolean): void => {
  const mutable = env as unknown as Record<string, string | boolean>;
  mutable.BKASH_PAYMENT_ENABLED = enabled;
  mutable.BKASH_PAYMENT_NUMBER = enabled ? '01711111111' : '';
};

/** Polls until `predicate` holds — emits are fire-and-forget by design. */
const waitFor = async (predicate: () => Promise<boolean>, ms = 4000): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

const findEvent = async (filter: Record<string, unknown>) =>
  ActivityEventModel.findOne(filter).lean().exec();

interface Fixture {
  user: UserDocument;
  product: Types.ObjectId;
  variant: Types.ObjectId;
}

const makeFixture = async (stock = 10): Promise<Fixture> => {
  const tag = unique('p1b');
  const user = await UserModel.create({
    email: `${tag}@example.com`,
    name: 'P1B Test User',
    role: 'customer',
  });
  const category = await CategoryModel.create({ name: `Cat ${tag}`, slug: `cat-${tag}` });
  const product = await ProductModel.create({
    name: `Product ${tag}`,
    slug: `product-${tag}`,
    description: 'Fixture product for Phase 1B authoritative event tests.',
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
    stock,
    lowStockThreshold: 5,
    images: [],
  });
  return { user, product: product._id, variant: variant._id };
};

const placeOrder = async (fixture: Fixture, checkoutId = randomUUID()) => {
  await addItem(fixture.user._id, fixture.variant.toString(), 2);
  return createOrder(fixture.user, {
    checkoutId,
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'P1B Test User',
      phone: '01700000000',
      line1: 'House 1, Road 1',
      isDefault: true,
    },
  });
};

const stockOf = async (variantId: Types.ObjectId): Promise<number | null> => {
  const variant = await VariantModel.findById(variantId).select('stock').lean().exec();
  return variant ? variant.stock : null;
};

describe('Phase 1B-B — authoritative commerce events (disposable database)', () => {
  let server: Server | undefined;
  let origin: string;
  const savedManual = {
    bkash: env.BKASH_PAYMENT_ENABLED,
    bkashNumber: env.BKASH_PAYMENT_NUMBER,
  };

  before(async () => {
    await connectTestDatabase();
    await Promise.all([
      ActivityEventModel.syncIndexes(),
      UserModel.syncIndexes(),
      CategoryModel.syncIndexes(),
      ProductModel.syncIndexes(),
      VariantModel.syncIndexes(),
      CartModel.syncIndexes(),
      OrderModel.syncIndexes(),
      NotificationModel.syncIndexes(),
    ]);
    setFlag(true);
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase();
    setFlag(true);
  });

  after(async () => {
    setFlag(false);
    setManual(savedManual.bkash);
    env.BKASH_PAYMENT_NUMBER = savedManual.bkashNumber;
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectTestDatabase();
  });

  it('emits checkout.started and order.purchased exactly once, after commit, with deterministic ids', async () => {
    const fixture = await makeFixture();
    const checkoutId = randomUUID();
    await addItem(fixture.user._id, fixture.variant.toString(), 2);
    const order = await createOrder(fixture.user, {
      checkoutId,
      paymentMethod: 'cod',
      shippingAddress: {
        fullName: 'P1B Test User',
        phone: '01700000000',
        line1: 'House 1, Road 1',
        isDefault: true,
      },
    });

    const purchased = await waitFor(async () =>
      Boolean(await findEvent({ type: 'order.purchased', orderId: order.id })),
    );
    assert.ok(purchased, 'order.purchased must be persisted');

    const purchaseEvent = await findEvent({ type: 'order.purchased', orderId: order.id });
    assert.ok(purchaseEvent);
    assert.equal(purchaseEvent.source, 'server');
    assert.equal(purchaseEvent.userId?.toString(), fixture.user._id.toString());
    assert.equal(purchaseEvent.value, order.total, 'value = authoritative order total');
    assert.equal(
      purchaseEvent.eventId,
      deterministicEventId(`order.purchased:${order.id}`),
      'purchase id is deterministic for retry dedup',
    );

    const started = await findEvent({
      type: 'checkout.started',
      userId: fixture.user._id,
    });
    assert.ok(started, 'checkout.started must be persisted after the cart claim');
    assert.equal(started.eventId, deterministicEventId(`checkout.started:${checkoutId}`));

    // Order is authoritative: stock decremented and cart cleared regardless of analytics.
    assert.equal(await stockOf(fixture.variant), 8);
    const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
    assert.equal(cart?.items.length, 0);
  });

  it('a checkoutId replay returns the original order WITHOUT a second purchase event', async () => {
    const fixture = await makeFixture();
    const checkoutId = randomUUID();
    const first = await placeOrder(fixture, checkoutId);
    await waitFor(async () =>
      Boolean(await findEvent({ type: 'order.purchased', orderId: first.id })),
    );

    const replayed = await createOrder(fixture.user, {
      checkoutId,
      paymentMethod: 'cod',
      shippingAddress: {
        fullName: 'P1B Test User',
        phone: '01700000000',
        line1: 'House 1, Road 1',
        isDefault: true,
      },
    });
    assert.equal(replayed.id, first.id, 'idempotent replay');

    await new Promise((resolve) => setTimeout(resolve, 200));
    const count = await ActivityEventModel.countDocuments({
      type: 'order.purchased',
      orderId: first.id,
    });
    assert.equal(count, 1, 'replay must not double-emit');
  });

  it('NEVER blocks checkout when analytics storage fails (failure injection)', async () => {
    const fixture = await makeFixture();
    const model = ActivityEventModel as unknown as {
      insertMany: typeof ActivityEventModel.insertMany;
    };
    const original = model.insertMany;
    model.insertMany = (async () => {
      throw new Error('injected analytics outage');
    }) as typeof ActivityEventModel.insertMany;
    try {
      const order = await placeOrder(fixture);
      assert.ok(order.id, 'order must be created despite analytics outage');
      assert.equal(await stockOf(fixture.variant), 8, 'stock intact');
      const stored = await OrderModel.findById(order.id).lean().exec();
      assert.ok(stored, 'order persisted');
      assert.equal(stored.status, 'pending');
    } finally {
      model.insertMany = original;
    }
  });

  it('emits order.cancelled on customer cancellation only after success', async () => {
    const fixture = await makeFixture();
    const order = await placeOrder(fixture);
    await waitFor(async () =>
      Boolean(await findEvent({ type: 'order.purchased', orderId: order.id })),
    );

    await cancelOrder(fixture.user, order.id);
    const cancelled = await waitFor(async () =>
      Boolean(await findEvent({ type: 'order.cancelled', orderId: order.id })),
    );
    assert.ok(cancelled);
    const event = await findEvent({ type: 'order.cancelled', orderId: order.id });
    assert.ok(event);
    assert.equal(event.eventId, deterministicEventId(`order.cancelled:${order.id}`));
    assert.equal(event.userId?.toString(), fixture.user._id.toString());
    assert.equal(await stockOf(fixture.variant), 10, 'stock restored');

    // Failed cancellation (already cancelled) must not add events.
    await assert.rejects(cancelOrder(fixture.user, order.id));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      await ActivityEventModel.countDocuments({ type: 'order.cancelled', orderId: order.id }),
      1,
    );
  });

  it('records admin status transitions with from/to, and admin cancels as order.cancelled', async () => {
    const fixture = await makeFixture();
    const admin = await UserModel.create({
      email: `${unique('p1b-admin')}@example.com`,
      name: 'P1B Admin',
      role: 'admin',
    });
    const order = await placeOrder(fixture);
    await waitFor(async () =>
      Boolean(await findEvent({ type: 'order.purchased', orderId: order.id })),
    );

    await adminUpdateOrderStatus(admin, order.id, { status: 'processing' });
    const changed = await waitFor(async () =>
      Boolean(await findEvent({ type: 'admin.order_status_changed', orderId: order.id })),
    );
    assert.ok(changed);
    const changeEvent = await findEvent({ type: 'admin.order_status_changed', orderId: order.id });
    assert.ok(changeEvent);
    assert.equal(changeEvent.fromStatus, 'pending');
    assert.equal(changeEvent.toStatus, 'processing');
    assert.equal(changeEvent.userId?.toString(), admin._id.toString());

    await adminUpdateOrderStatus(admin, order.id, { status: 'cancelled' });
    const adminCancel = await waitFor(async () =>
      Boolean(
        await findEvent({
          type: 'order.cancelled',
          orderId: order.id,
          userId: admin._id,
        }),
      ),
    );
    assert.ok(adminCancel, 'admin cancellation emits the canonical order.cancelled fact');
    await new Promise((resolve) => setTimeout(resolve, 150));
    // One cancellation fact only — never a double-counted status change too.
    assert.equal(
      await ActivityEventModel.countDocuments({ type: 'order.cancelled', orderId: order.id }),
      1,
    );
  });

  it('emits cart.* events after successful mutations with final quantities', async () => {
    const fixture = await makeFixture();
    await addItem(fixture.user._id, fixture.variant.toString(), 2);
    assert.ok(await waitFor(async () => Boolean(await findEvent({ type: 'cart.add' }))));

    const addEvent = await findEvent({ type: 'cart.add' });
    assert.ok(addEvent);
    assert.equal(addEvent.source, 'server');
    assert.equal(addEvent.quantity, 2, 'final line quantity');
    assert.equal(addEvent.variantId?.toString(), fixture.variant.toString());
    assert.equal(addEvent.productId?.toString(), fixture.product.toString());

    await updateItem(fixture.user._id, fixture.variant.toString(), 1);
    await removeItem(fixture.user._id, fixture.variant.toString());
    await clearCart(fixture.user._id);
    assert.ok(await waitFor(async () => Boolean(await findEvent({ type: 'cart.clear' }))));

    const updateEvent = await findEvent({ type: 'cart.update' });
    assert.ok(updateEvent, 'cart.update emitted');
    assert.equal(updateEvent.quantity, 1);
    const removeEvent = await findEvent({ type: 'cart.remove' });
    assert.ok(removeEvent, 'cart.remove emitted');
    assert.equal(removeEvent.quantity, undefined, 'no quantity for a removed line');
  });

  it('emits auth.register / auth.login from the auth controllers (HTTP)', async () => {
    const email = `${unique('p1b-auth')}@example.com`;
    const password = 'Sup3rSecret!';

    const registered = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Auth User' }),
    });
    assert.equal(registered.status, 201);
    assert.ok(await waitFor(async () => Boolean(await findEvent({ type: 'auth.register' }))));
    const registerEvent = await findEvent({ type: 'auth.register' });
    assert.ok(registerEvent);
    assert.equal(registerEvent.source, 'server');

    const loggedIn = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loggedIn.status, 200);
    assert.ok(await waitFor(async () => Boolean(await findEvent({ type: 'auth.login' }))));
    const loginEvent = await findEvent({ type: 'auth.login' });
    assert.ok(loginEvent);
    assert.equal(loginEvent.source, 'server');
    assert.equal(loginEvent.userId?.toString(), registerEvent.userId?.toString());
  });

  it('audits identifiable customer detail views (admin.customer_viewed)', async () => {
    const admin = await UserModel.create({
      email: `${unique('p1b-auditor')}@example.com`,
      name: 'P1B Auditor',
      role: 'admin',
    });
    const customer = await UserModel.create({
      email: `${unique('p1b-target')}@example.com`,
      name: 'P1B Target',
      role: 'customer',
    });

    const result = await adminGetCustomer(customer._id.toString());
    assert.equal(result.user.id, customer._id.toString());

    // The audit emit lives in the admin controller — exercise it over HTTP
    // with a verified admin cookie (server-verified authorization).
    const response = await fetch(`${origin}/api/admin/customers/${customer._id.toString()}`, {
      headers: { Cookie: `al_token=${signAuthToken(admin._id.toString(), 'admin')}` },
    });
    assert.equal(response.status, 200);

    const audited = await waitFor(async () =>
      Boolean(await findEvent({ type: 'admin.customer_viewed' })),
    );
    assert.ok(audited, 'customer view must be audited');
    const event = await findEvent({ type: 'admin.customer_viewed' });
    assert.ok(event);
    assert.equal(event.userId?.toString(), admin._id.toString(), 'actor = admin');
    assert.equal(event.customerId?.toString(), customer._id.toString(), 'target = customer');
  });

  it('rejects non-admin access to the audited customer endpoint (403) and emits nothing', async () => {
    const customer = await UserModel.create({
      email: `${unique('p1b-guard')}@example.com`,
      name: 'P1B Guard',
      role: 'customer',
    });
    const other = await makeFixture();
    const response = await fetch(`${origin}/api/admin/customers/${customer._id.toString()}`, {
      headers: { Cookie: `al_token=${signAuthToken(other.user._id.toString(), 'customer')}` },
    });
    assert.equal(response.status, 403);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(await ActivityEventModel.countDocuments({ type: 'admin.customer_viewed' }), 0);
  });

  it('emits payment claim/review/refund events with ids and outcome only — NO transaction references', async () => {
    setManual(true);
    await OrderModel.syncIndexes(); // payment_trxid_unique for the manual flow
    const fixture = await makeFixture();
    const admin = await UserModel.create({
      email: `${unique('p1b-pay-admin')}@example.com`,
      name: 'P1B Pay Admin',
      role: 'admin',
    });

    await addItem(fixture.user._id, fixture.variant.toString(), 2);
    const order = await createOrder(fixture.user, {
      checkoutId: randomUUID(),
      paymentMethod: 'bkash',
      shippingAddress: {
        fullName: 'P1B Test User',
        phone: '01700000000',
        line1: 'House 1, Road 1',
        isDefault: true,
      },
    });

    const trxId = `TRX${unique('p1b').toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 20);
    await submitManualPayment(fixture.user, order.id, {
      senderNumber: '01712345678',
      trxId,
    });
    const submitted = await waitFor(async () =>
      Boolean(await findEvent({ type: 'payment.claim_submitted', orderId: order.id })),
    );
    assert.ok(submitted, 'claim submitted event');

    const claimDoc = await findEvent({ type: 'payment.claim_submitted', orderId: order.id });
    assert.ok(claimDoc);
    const claimKeys = Object.keys(claimDoc);
    for (const forbidden of ['trxId', 'senderNumber', 'value', 'query', 'path']) {
      assert.ok(!claimKeys.includes(forbidden), `"${forbidden}" must not be on the event`);
    }

    const stored = await OrderModel.findById(order.id).exec();
    assert.ok(stored);
    const claim = stored.payment?.claims.find((item) => item.status === 'pending_verification');
    assert.ok(claim?._id);

    await reviewManualPayment(admin, order.id, {
      claimId: claim._id.toString(),
      decision: 'paid',
    });
    const reviewed = await waitFor(async () =>
      Boolean(await findEvent({ type: 'payment.claim_reviewed', orderId: order.id })),
    );
    assert.ok(reviewed, 'claim reviewed event');
    const reviewEvent = await findEvent({ type: 'payment.claim_reviewed', orderId: order.id });
    assert.ok(reviewEvent);
    assert.equal(reviewEvent.decision, 'paid');
    assert.equal(reviewEvent.eventId, deterministicEventId(`payment.claim.reviewed:${claim._id.toString()}`));
    assert.equal(reviewEvent.userId?.toString(), admin._id.toString());

    // Move to refund_pending and complete a refund.
    await OrderModel.updateOne({ _id: order.id }, { $set: { paymentStatus: 'refund_pending' } });
    await completeManualRefund(admin, order.id, {
      refundReference: `RF${unique('p1b').toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 16),
      refundAmount: order.total,
      refundRecipient: '01712345678',
      confirmed: true,
    });
    const refunded = await waitFor(async () =>
      Boolean(await findEvent({ type: 'payment.refunded', orderId: order.id })),
    );
    assert.ok(refunded, 'refund event');
    const refundEvent = await findEvent({ type: 'payment.refunded', orderId: order.id });
    assert.ok(refundEvent);
    assert.equal(refundEvent.eventId, deterministicEventId(`payment.refunded:${order.id}`));
    const refundKeys = Object.keys(refundEvent);
    for (const forbidden of ['value', 'query', 'path']) {
      assert.ok(!refundKeys.includes(forbidden), `"${forbidden}" must not be on the refund event`);
    }

    // Global sweep: NO event document anywhere may carry payment references.
    const all = await ActivityEventModel.find({}).lean();
    assert.ok(all.length >= 4);
    for (const doc of all) {
      const keys = Object.keys(doc);
      for (const forbidden of ['trxId', 'trxIdNormalized', 'senderNumber', 'ip', 'userAgent', 'password']) {
        assert.ok(!keys.includes(forbidden), `event ${doc.type} leaked "${forbidden}"`);
      }
    }
  });

  it('payment flow is never blocked by analytics failure', async () => {
    setManual(true);
    await OrderModel.syncIndexes();
    const fixture = await makeFixture();
    const admin = await UserModel.create({
      email: `${unique('p1b-pay2')}@example.com`,
      name: 'P1B Pay2 Admin',
      role: 'admin',
    });
    await addItem(fixture.user._id, fixture.variant.toString(), 2);
    const order = await createOrder(fixture.user, {
      checkoutId: randomUUID(),
      paymentMethod: 'bkash',
      shippingAddress: {
        fullName: 'P1B Test User',
        phone: '01700000000',
        line1: 'House 1, Road 1',
        isDefault: true,
      },
    });

    const model = ActivityEventModel as unknown as {
      insertMany: typeof ActivityEventModel.insertMany;
    };
    const original = model.insertMany;
    model.insertMany = (async () => {
      throw new Error('injected analytics outage');
    }) as typeof ActivityEventModel.insertMany;
    try {
      await submitManualPayment(fixture.user, order.id, {
        senderNumber: '01712345678',
        trxId: `OK${unique('p1b').toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 18),
      });
      const stored = await OrderModel.findById(order.id).exec();
      assert.ok(stored);
      assert.equal(stored.paymentStatus, 'pending_verification', 'claim recorded despite outage');
      const claim = stored.payment?.claims.find((item) => item.status === 'pending_verification');
      assert.ok(claim);
      assert.ok(claim._id);
      await reviewManualPayment(admin, order.id, {
        claimId: claim._id.toString(),
        decision: 'paid',
      });
      const reviewed = await OrderModel.findById(order.id).exec();
      assert.equal(reviewed?.paymentStatus, 'paid', 'review recorded despite outage');
    } finally {
      model.insertMany = original;
    }
  });

  it('writes ZERO events while the flag is off, without affecting business outcomes', async () => {
    setFlag(false);
    const fixture = await makeFixture();
    const order = await placeOrder(fixture);
    assert.ok(order.id);
    await cancelOrder(fixture.user, order.id);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await ActivityEventModel.countDocuments({}), 0, 'flag off ⇒ zero event writes');
    assert.equal(await stockOf(fixture.variant), 10, 'business flow unaffected');
  });

  it('refuses event writes (not business writes) when activity indexes are missing', async () => {
    await ActivityEventModel.collection.drop().catch(() => undefined);
    const fixture = await makeFixture();
    const order = await placeOrder(fixture); // business flow must still work
    assert.ok(order.id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      await ActivityEventModel.countDocuments({}),
      0,
      'no events persisted without indexes (fail-closed, R-1)',
    );
    assert.equal(await stockOf(fixture.variant), 8, 'checkout unaffected');

    // Restore for subsequent runs.
    const db = mongoose.connection.db;
    assert.ok(db);
    await db.createCollection('activity_events').catch(() => undefined);
    await ActivityEventModel.syncIndexes();
  });
});
