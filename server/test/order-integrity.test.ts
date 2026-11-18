import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { readDeploymentCapabilities } from '../src/config/mongo-capabilities.js';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { createVariant, deleteProduct, deleteVariant, restoreVariant } from '../src/services/admin-catalog.service.js';
import { adminUpdateOrderStatus } from '../src/services/admin-order.service.js';
import { createApp } from '../src/app.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { addItem, clearCart, getCart, mergeGuestItems, removeItem, updateItem } from '../src/services/cart.service.js';
import { cancelOrder, createOrder } from '../src/services/order.service.js';
import { AppError } from '../src/middleware/error-handler.js';
import { CHECKOUT_CLAIM_STALE_MS } from '../src/config/checkout.js';
import { addAddress, updateAddress, deleteAddress, updateProfile } from '../src/services/user.service.js';
import { adminListOrders } from '../src/services/admin-order.service.js';
import { adminOrderQuerySchema } from '../src/schemas/admin.schema.js';
import { addressSchema, addressUpdateSchema } from '../src/schemas/user.schema.js';
import { seedData } from '../src/scripts/seed.js';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';

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
  options: { stock?: number; price?: number | null; basePrice?: number } = {},
): Promise<Fixture> => {
  const tag = unique('p0');
  const user = await UserModel.create({
    email: `${tag}@example.com`,
    name: 'P0 Test User',
    role: 'customer',
  });
  const category = await CategoryModel.create({ name: `Cat ${tag}`, slug: `cat-${tag}` });
  const product = await ProductModel.create({
    name: `Product ${tag}`,
    slug: `product-${tag}`,
    description: 'Fixture product for Phase 0 regression tests.',
    category: category._id,
    basePrice: options.basePrice ?? 10000,
    images: [],
    status: 'active',
  });
  const sku = `SKU-${tag}`;
  const variant = await VariantModel.create({
    product: product._id,
    sku,
    size: 'M',
    color: null,
    price: options.price === undefined ? null : options.price,
    stock: options.stock ?? 10,
    lowStockThreshold: 5,
    images: [],
  });

  return { user, product: product._id, variant: variant._id, sku: variant.sku };
};

const addSecondVariant = async (fixture: Fixture, stock = 5): Promise<Types.ObjectId> => {
  const variant = await VariantModel.create({
    product: fixture.product,
    sku: `SKU2-${unique('v')}`,
    size: 'L',
    color: null,
    price: null,
    stock,
    lowStockThreshold: 5,
    images: [],
  });
  return variant._id;
};

const placeOrder = async (user: UserDocument, checkoutId = randomUUID()) =>
  createOrder(user, {
    checkoutId,
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'P0 Test User',
      phone: '01700000000',
      line1: 'House 1, Road 1',
      isDefault: true,
    },
  });

const stockOf = async (variantId: Types.ObjectId): Promise<number | null> => {
  const variant = await VariantModel.findById(variantId).select('stock').lean().exec();
  return variant ? variant.stock : null;
};

describe('Phase 0 — order integrity (A5, B1, B2, B3)', () => {
  let server: Server | undefined;
  let origin: string;
  before(async () => {
    // Fail-closed: refuses unless the *resolved* database is a designated *_test DB.
    await connectTestDatabase();

    // A1: the suite refuses to run on a deployment without transactions.
    const db = mongoose.connection.db;
    assert.ok(db, 'connected database handle is available');
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
    ]);
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await disconnectTestDatabase();
  });

  // ---- A5 -----------------------------------------------------------------
  describe('Phase 1 business functionality', () => {
    it('edits and explicitly clears all optional address values while omitted fields and order snapshots survive', async () => {
      const fixture = await makeFixture();
      const fields = ['label', 'line2', 'city', 'state', 'postalCode', 'country'] as const;
      const input = addressSchema.parse({ fullName: 'Customer', phone: '01712345678', line1: 'Dhaka',
        label: 'Home', line2: 'Flat 4', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' });
      const address = await addAddress(fixture.user, input); assert.ok(address._id);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await createOrder(fixture.user, { checkoutId: randomUUID(), paymentMethod: 'cod', shippingAddress: input });
      const snapshot = JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress);
      await updateAddress(fixture.user, address._id.toString(), addressUpdateSchema.parse({ line1: 'New street' }));
      let stored = (await UserModel.findById(fixture.user._id))?.addresses[0];
      for (const field of fields) assert.equal(stored?.[field], input[field], 'omitted values are preserved');
      const edits = Object.fromEntries(fields.map((field) => [field, `New ${field}`]));
      await updateAddress(fixture.user, address._id.toString(), addressUpdateSchema.parse(edits));
      stored = (await UserModel.findById(fixture.user._id))?.addresses[0];
      for (const field of fields) assert.equal(stored?.[field], `New ${field}`);
      const cleared = Object.fromEntries(fields.map((field) => [field, '   ']));
      await updateAddress(fixture.user, address._id.toString(), addressUpdateSchema.parse(cleared));
      stored = (await UserModel.findById(fixture.user._id))?.addresses[0];
      for (const field of fields) assert.equal(stored?.[field], '', 'explicit clears persist in MongoDB');
      assert.ok(stored?.isDefault);
      assert.equal(JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress), snapshot);
      assert.throws(() => addressUpdateSchema.parse({ line1: '' }));
      assert.throws(() => addressUpdateSchema.parse({ label: 'x'.repeat(31) }));
    });
    for (const status of ['pending', 'processing', 'shipped', 'cancelled'] as const) {
      it(`customer cancellation from ${status}`, async () => {
        const fixture = await makeFixture({ stock: 5 });
        await addItem(fixture.user._id, fixture.variant.toString(), 1);
        const order = await placeOrder(fixture.user);
        if (status !== 'pending') await OrderModel.updateOne({ _id: order.id }, { $set: { status } });
        if (status === 'pending' || status === 'processing') {
          await deleteVariant(fixture.variant.toString());
          await cancelOrder(fixture.user, order.id);
          assert.equal(await stockOf(fixture.variant), 5);
          await assert.rejects(cancelOrder(fixture.user, order.id));
        } else {
          await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => error instanceof AppError && error.statusCode === 409);
          assert.equal(await stockOf(fixture.variant), 4);
        }
      });
    }
    it('serializes customer cancellation against shipment and administrative cancellation', async () => {
      for (const target of ['shipped', 'cancelled'] as const) {
        const fixture = await makeFixture({ stock: 5 });
        await addItem(fixture.user._id, fixture.variant.toString(), 1);
        const order = await placeOrder(fixture.user);
        await OrderModel.updateOne({ _id: order.id }, { $set: { status: 'processing' } });
        await Promise.allSettled([cancelOrder(fixture.user, order.id), adminUpdateOrderStatus(fixture.user, order.id, { status: target })]);
        const stored = await OrderModel.findById(order.id);
        assert.ok(stored);
        assert.ok(stored.status === 'cancelled' || stored.status === 'shipped');
        assert.equal(stored.stockRestored, stored.status === 'cancelled');
        assert.equal(await stockOf(fixture.variant), stored.status === 'cancelled' ? 5 : 4);
      }
    });
    it('serializes address/default changes, rejects foreign ids and preserves order snapshots', async () => {
      const fixture = await makeFixture();
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await placeOrder(fixture.user);
      const original = JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress);
      const input = addressSchema.parse({ fullName: 'Customer', phone: '+8801712345678', line1: 'Dhaka', isDefault: true });
      const [first, second] = await Promise.all([addAddress(fixture.user, input), addAddress(fixture.user, input)]);
      assert.ok(first._id && second._id);
      await Promise.all([updateAddress(fixture.user, first._id.toString(), { isDefault: true }), updateAddress(fixture.user, second._id.toString(), { isDefault: true }), updateProfile(fixture.user, { name: 'New name' })]);
      let stored = await UserModel.findById(fixture.user._id);
      assert.equal(stored?.addresses.length, 2);
      assert.equal(stored?.addresses.filter((a) => a.isDefault).length, 1);
      assert.equal(stored?.name, 'New name');
      const other = await makeFixture();
      await assert.rejects(updateAddress(other.user, first._id.toString(), { line1: 'Wrong owner' }), (error: unknown) => error instanceof AppError && error.statusCode === 404);
      const defaultId = stored?.addresses.find((a) => a.isDefault)?._id;
      assert.ok(defaultId);
      await deleteAddress(fixture.user, defaultId.toString());
      stored = await UserModel.findById(fixture.user._id);
      assert.equal(stored?.addresses.length, 1);
      assert.equal(stored?.addresses[0]?.isDefault, true);
      assert.equal(JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress), original);
    });
    it('searches normalized phones and order numbers with status pagination and indexed plans', async () => {
      const fixture = await makeFixture();
      for (let i = 0; i < 3; i++) { await addItem(fixture.user._id, fixture.variant.toString(), 1); await placeOrder(fixture.user); }
      const phone = '01700000000';
      const page = await adminListOrders(adminOrderQuerySchema.parse({ search: '+8801700000000', status: 'pending', page: 2, limit: 1 }));
      assert.equal(page.total, 3); assert.equal(page.items.length, 1); assert.equal(page.totalPages, 3);
      const number = page.items[0]?.orderNumber;
      assert.ok(number);
      assert.equal((await adminListOrders(adminOrderQuerySchema.parse({ search: number.toLowerCase() }))).total, 1);
      assert.equal((await adminListOrders(adminOrderQuerySchema.parse({ search: phone, status: 'shipped' }))).total, 0);
      assert.throws(() => adminOrderQuerySchema.parse({ search: '.*' }));
      const plan = await OrderModel.collection.find({ 'shippingAddress.phone': phone, status: 'pending' }).sort({ createdAt: -1, _id: -1 }).limit(1).explain('executionStats');
      assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /IXSCAN/);
      assert.ok(plan.executionStats.totalDocsExamined <= 1);
    });
    it('seeds cost-12 credentials and draft demos without resetting repeated-seed stock or credentials', async () => {
      await seedData();
      const admin = await UserModel.findOne({ email: env.ADMIN_EMAIL });
      assert.ok(admin?.passwordHash);
      assert.equal(bcrypt.getRounds(admin.passwordHash), 12);
      assert.equal(await bcrypt.compare(env.ADMIN_PASSWORD, admin.passwordHash), true);
      assert.equal(await ProductModel.countDocuments({ status: 'active' }), 0);
      assert.equal(await ProductModel.countDocuments({ status: 'draft' }), 4);
      const demos = await ProductModel.find().sort({ _id: 1 });
      const invalid = demos[0]; const legitimate = demos[1];
      assert.ok(invalid && legitimate);
      await ProductModel.updateOne({ _id: invalid._id }, { $set: { status: 'active' } });
      await ProductModel.updateOne({ _id: legitimate._id }, { $set: { status: 'active', images: ['https://images.example.test/fixture.jpg'] } });
      const variant = await VariantModel.findOne(); assert.ok(variant);
      await VariantModel.updateOne({ _id: variant._id }, { $set: { stock: 2 } });
      const counts = [await UserModel.countDocuments(), await ProductModel.countDocuments(), await VariantModel.countDocuments()];
      await seedData();
      assert.equal((await ProductModel.findById(invalid._id))?.status, 'draft');
      assert.equal((await ProductModel.findById(legitimate._id))?.status, 'active');
      assert.deepEqual([await UserModel.countDocuments(), await ProductModel.countDocuments(), await VariantModel.countDocuments()], counts);
      assert.equal((await UserModel.findById(admin._id))?.passwordHash, admin.passwordHash);
      assert.equal(await stockOf(variant._id), 2);
    });
  });
  describe('A5 — variant deletion vs. order history', () => {
    it('archives a variant referenced by an order and restores its stock on cancel', async () => {
      const fixture = await makeFixture({ stock: 10 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      assert.equal(await stockOf(fixture.variant), 8);

      const result = await deleteVariant(fixture.variant.toString());
      assert.deepEqual(result, { deleted: false, archived: true, orderCount: 1 });

      const archived = await VariantModel.findById(fixture.variant).lean().exec();
      assert.ok(archived, 'variant document is retained');
      assert.ok(archived.archivedAt instanceof Date);
      assert.equal(archived.stock, 8);

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 10, 'stock restored into the archived variant');
    });

    it('hard-deletes a variant that no order references', async () => {
      const fixture = await makeFixture({ stock: 4 });
      const second = await addSecondVariant(fixture, 3);

      const result = await deleteVariant(second.toString());
      assert.deepEqual(result, { deleted: true, archived: false, orderCount: 0 });
      assert.equal(await VariantModel.findById(second).lean().exec(), null);
    });

    it('refuses to retire the last purchasable variant', async () => {
      const fixture = await makeFixture({ stock: 4 });
      await assert.rejects(deleteVariant(fixture.variant.toString()), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /only purchasable variant/);
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 4);
    });

    it('aborts the cancellation when the variant no longer exists (no false success)', async () => {
      const fixture = await makeFixture({ stock: 6 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      // Simulate legacy data: the variant document is gone while the order lives.
      await VariantModel.deleteOne({ _id: fixture.variant }).exec();

      await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'STOCK_RESTORE_FAILED');
        return true;
      });

      const reloaded = await OrderModel.findById(order.id).lean().exec();
      assert.ok(reloaded);
      assert.equal(reloaded.status, 'pending', 'order stays pending — nothing was cancelled');
      assert.equal(reloaded.stockRestored, false);
    });
  });

  // ---- B1 -----------------------------------------------------------------
  describe('B1 — cart mutations during checkout', () => {
    it('rejects every cart mutation while a checkout claim is active', async () => {
      const fixture = await makeFixture({ stock: 5 });
      const second = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await CartModel.updateOne(
        { user: fixture.user._id },
        { $set: { checkoutInProgress: new Date() } },
      ).exec();

      const expectBusy = async (operation: Promise<unknown>) => {
        await assert.rejects(operation, (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'CHECKOUT_IN_PROGRESS');
          return true;
        });
      };

      await expectBusy(addItem(fixture.user._id, second.toString(), 1));
      await expectBusy(updateItem(fixture.user._id, fixture.variant.toString(), 2));
      await expectBusy(removeItem(fixture.user._id, fixture.variant.toString()));
      await expectBusy(clearCart(fixture.user._id));
      await expectBusy(mergeGuestItems(fixture.user._id, [{ variantId: second.toString(), quantity: 1 }]));

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.ok(cart);
      assert.equal(cart.items.length, 1, 'cart unchanged while checkout is in progress');
      assert.equal(cart.items[0]?.quantity, 1);
    });

    it('accepts mutations once the claim is stale (crashed checkout recovery)', async () => {
      const fixture = await makeFixture({ stock: 5 });
      const second = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      await CartModel.updateOne(
        { user: fixture.user._id },
        {
          $set: {
            checkoutInProgress: new Date(Date.now() - CHECKOUT_CLAIM_STALE_MS - 5_000),
            version: 0,
          },
        },
      ).exec();

      const view = await addItem(fixture.user._id, second.toString(), 1);
      assert.equal(view.items.length, 2);

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.version, 1, 'version bumped by the successful mutation');
    });

    it('never loses an item added concurrently with checkout', async () => {
      for (let round = 0; round < 5; round += 1) {
        await resetTestDatabase();
        const fixture = await makeFixture({ stock: 5 });
        const concurrent = await addSecondVariant(fixture, 5);
        await addItem(fixture.user._id, fixture.variant.toString(), 1);

        const [orderResult, addResult] = await Promise.allSettled([
          placeOrder(fixture.user),
          addItem(fixture.user._id, concurrent.toString(), 1),
        ]);

        if (addResult.status === 'rejected') {
          assert.ok(addResult.reason instanceof AppError);
          assert.equal(addResult.reason.code, 'CHECKOUT_IN_PROGRESS');
        }

        const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
        const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();

        const cartQty = (variant: Types.ObjectId): number =>
          cart?.items
            .filter((item) => item.variant.equals(variant))
            .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
        const orderQty = (variant: Types.ObjectId): number =>
          orders
            .flatMap((order) => order.items)
            .filter((item) => item.variant.equals(variant))
            .reduce((sum, item) => sum + item.quantity, 0);

        // The original line is accounted exactly once: in the order or still in the cart.
        assert.equal(cartQty(fixture.variant) + orderQty(fixture.variant), 1);

        if (addResult.status === 'fulfilled') {
          assert.equal(
            cartQty(concurrent) + orderQty(concurrent),
            1,
            'a concurrently added item survives in the cart or the order',
          );
        }

        if (orderResult.status === 'fulfilled') {
          assert.equal(orders.length, 1);
          assert.equal(cart?.items.length ?? 0, addResult.status === 'fulfilled' ? cartQty(concurrent) : 0);
        }

        for (const variant of await VariantModel.find({
          _id: { $in: [fixture.variant, concurrent] },
        })
          .lean()
          .exec()) {
          assert.ok(variant.stock >= 0, 'stock never goes negative');
        }
      }
    });

    it('replays a checkoutId without a second order or stock decrement', async () => {
      const fixture = await makeFixture({ stock: 8 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const checkoutId = randomUUID();
      const first = await placeOrder(fixture.user, checkoutId);
      const second = await placeOrder(fixture.user, checkoutId);

      assert.equal(first.id, second.id);
      assert.equal(await OrderModel.countDocuments({ checkoutId }).exec(), 1);
      assert.equal(await stockOf(fixture.variant), 6, 'stock decremented exactly once');
    });
  });

  // ---- B2 -----------------------------------------------------------------
  describe('B2 — first cart creation race', () => {
    it('creates exactly one cart for many concurrent first requests', async () => {
      const tag = unique('race');
      const user = await UserModel.create({
        email: `${tag}@example.com`,
        name: 'Race User',
        role: 'customer',
      });

      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => getCart(user._id)),
      );

      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(
        rejected.length,
        0,
        `no first-cart request may fail: ${rejected
          .map((result) => String((result as PromiseRejectedResult).reason))
          .join(' | ')}`,
      );
      assert.equal(await CartModel.countDocuments({ user: user._id }).exec(), 1);
      for (const result of results) {
        assert.equal(result.status, 'fulfilled');
        if (result.status === 'fulfilled') {
          assert.deepEqual(result.value.items, []);
        }
      }
    });

    it('keeps carts isolated per user', async () => {
      const first = await makeFixture({ stock: 3 });
      const second = await makeFixture({ stock: 3 });
      await addItem(first.user._id, first.variant.toString(), 2);

      const firstCart = await CartModel.findOne({ user: first.user._id }).lean().exec();
      const secondCart = await CartModel.findOne({ user: second.user._id }).lean().exec();

      assert.equal(secondCart, null, 'another user has no cart until they use one');
      assert.equal(firstCart?.items.length, 1);
      const secondView = await getCart(second.user._id);
      assert.deepEqual(secondView.items, []);
    });
  });

  // ---- B3 -----------------------------------------------------------------
  describe('B3 — checkout rejects unorderable lines', () => {
    const expectNotOrderable = async (promise: Promise<unknown>, pattern: RegExp) => {
      await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'CART_NOT_ORDERABLE');
        assert.equal(error.statusCode, 409);
        const details = error.details as Array<{ path: string; message: string }> | undefined;
        assert.ok(Array.isArray(details) && details.length > 0, 'per-line details are returned');
        assert.match(details[0]?.message ?? '', pattern);
        return true;
      });
    };

    it('rejects an archived variant and leaves the cart and stock untouched', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await VariantModel.updateOne(
        { _id: fixture.variant },
        { $set: { archivedAt: new Date() } },
      ).exec();

      await expectNotOrderable(placeOrder(fixture.user), /no longer sold/);

      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 5);
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1, 'cart is preserved for the shopper to fix');
      assert.equal(cart?.checkoutInProgress, null, 'claim released after the failure');
    });

    it('rejects a product that is no longer published', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await ProductModel.updateOne({ _id: fixture.product }, { $set: { status: 'draft' } }).exec();

      await expectNotOrderable(placeOrder(fixture.user), /not available/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
    });

    it('rejects a quantity above stock with the available amount', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 3);
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { stock: 1 } }).exec();

      await expectNotOrderable(placeOrder(fixture.user), /only 1 left in stock/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 1);
    });

    it('rejects a line without a usable price instead of creating a ৳0 order', async () => {
      const fixture = await makeFixture({ stock: 5, basePrice: 0, price: null });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      await expectNotOrderable(placeOrder(fixture.user), /price is unavailable/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
    });

    it('rejects a cart line with a non-positive quantity', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      // Bypass schema validation to simulate corrupt/legacy data.
      await CartModel.collection.updateOne(
        { user: fixture.user._id },
        { $set: { 'items.0.quantity': 0 } },
      );

      await expectNotOrderable(placeOrder(fixture.user), /quantity is not valid/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 5);
    });

    it('still places a valid COD order with server-computed prices', async () => {
      const fixture = await makeFixture({ stock: 5, basePrice: 10000, price: 12000 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const order = await placeOrder(fixture.user);

      assert.equal(order.status, 'pending');
      assert.equal(order.paymentMethod, 'cod');
      assert.equal(order.items.length, 1);
      assert.equal(order.items[0]?.unitPrice, 12000, 'variant price override wins');
      assert.equal(order.subtotal, 24000);
      assert.equal(order.total, 24000);
      assert.equal(order.items[0]?.sku, fixture.sku, 'snapshot keeps the SKU');
      assert.equal(order.items[0]?.name.startsWith('Product '), true);
      assert.equal(await stockOf(fixture.variant), 3);

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 0, 'cart cleared after checkout');
    });
  });

  // ---- Transaction atomicity / claim recovery -----------------------------
  describe('A1/B1 — transaction failure and claim recovery', () => {
    type CreateFn = typeof OrderModel.create;

    /** Test seam: make the order insert fail after the stock decrements. */
    const failOrderInsert = (): (() => void) => {
      const original = OrderModel.create.bind(OrderModel);
      (OrderModel as unknown as { create: CreateFn }).create = (() => {
        throw new Error('forced order insert failure');
      }) as unknown as CreateFn;
      return () => {
        (OrderModel as unknown as { create: CreateFn }).create = original as unknown as CreateFn;
      };
    };

    it('rolls the whole checkout back when the order insert fails after the decrement', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const restore = failOrderInsert();
      try {
        await assert.rejects(placeOrder(fixture.user), /forced order insert failure/);
      } finally {
        restore();
      }

      assert.equal(await stockOf(fixture.variant), 5, 'the stock decrement was rolled back');
      assert.equal(await OrderModel.countDocuments().exec(), 0, 'no partial order was written');
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1, 'cart is untouched');
      assert.equal(cart?.checkoutInProgress, null, 'claim released after the failure');

      // Recovery: an immediate retry succeeds with the correct stock delta.
      const order = await placeOrder(fixture.user);
      assert.equal(order.items.length, 1);
      assert.equal(await stockOf(fixture.variant), 3);
    });

    it('restores stock exactly once and rejects a second cancellation', async () => {
      const fixture = await makeFixture({ stock: 6 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 5);

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 6);

      await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 6, 'no second restore');

      const reloaded = await OrderModel.findById(order.id).lean().exec();
      assert.equal(reloaded?.stockRestored, true);
    });
  });

  // ---- Concurrency between order lifecycle and catalog changes -------------
  describe('A5 — checkout/cancel racing a variant deletion', () => {
    it('keeps the invariant when a cancellation and a deletion race', async () => {
      const fixture = await makeFixture({ stock: 6 });
      const sibling = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 4);

      const [cancelResult] = await Promise.allSettled([
        cancelOrder(fixture.user, order.id),
        deleteVariant(fixture.variant.toString()),
      ]);

      const reloadedOrder = await OrderModel.findById(order.id).lean().exec();
      const variant = await VariantModel.findById(fixture.variant).lean().exec();

      if (cancelResult.status === 'fulfilled') {
        assert.equal(reloadedOrder?.status, 'cancelled');
        assert.equal(reloadedOrder?.stockRestored, true);
        assert.ok(variant, 'a variant referenced by an order is never hard-deleted');
        assert.ok(variant?.archivedAt instanceof Date);
        assert.equal(variant?.stock, 6, 'stock restored exactly once');
      } else {
        assert.ok(cancelResult.reason instanceof AppError);
        assert.equal(reloadedOrder?.status, 'pending');
        assert.equal(reloadedOrder?.stockRestored, false);
        if (variant) {
          assert.equal(variant.stock, 4, 'no partial restore');
        }
      }
      assert.equal(await stockOf(sibling), 5, 'unrelated variant untouched');
    });

    it('never commits an order that references a deleted variant', async () => {
      for (let round = 0; round < 4; round += 1) {
        await resetTestDatabase();
        const fixture = await makeFixture({ stock: 3 });
        await addSecondVariant(fixture, 3); // keeps the last-variant rule out of the way
        await addItem(fixture.user._id, fixture.variant.toString(), 1);

        const [orderResult, deleteResult] = await Promise.allSettled([
          placeOrder(fixture.user),
          deleteVariant(fixture.variant.toString()),
        ]);

        const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();
        const variant = await VariantModel.findById(fixture.variant).lean().exec();

        if (orders.length > 0) {
          assert.equal(orderResult.status, 'fulfilled');
          assert.ok(variant, 'a committed order must keep its variant document');
          assert.ok(variant?.archivedAt instanceof Date, 'and that variant is archived');
          assert.equal(variant?.stock, 2, 'decremented exactly once');
          assert.equal(orders[0]?.items[0]?.variant.toString(), fixture.variant.toString());
        } else {
          assert.equal(orderResult.status, 'rejected');
          assert.equal(deleteResult.status, 'fulfilled');
          assert.equal(variant, null, 'no order → the deletion may win and remove it');
        }
        if (variant) {
          assert.ok(variant.stock >= 0, 'stock never negative');
        }
      }
    });
  });

  // ---- Duplicate-key policy ------------------------------------------------
  describe('B2 — duplicate-key policy', () => {
    it('does not suppress unrelated errors and rethrows an unrecoverable duplicate key', async () => {
      const user = await UserModel.create({
        email: `${unique('b2')}@example.com`,
        name: 'B2 User',
        role: 'customer',
      });
      type InsertFn = typeof CartModel.findOneAndUpdate;
      const original = CartModel.findOneAndUpdate.bind(CartModel);

      const patchInsert = (error: unknown): void => {
        (CartModel as unknown as { findOneAndUpdate: InsertFn }).findOneAndUpdate = (() => ({
          exec: async () => {
            throw error;
          },
        })) as unknown as InsertFn;
      };
      const restore = (): void => {
        (CartModel as unknown as { findOneAndUpdate: InsertFn }).findOneAndUpdate =
          original as unknown as InsertFn;
      };

      try {
        patchInsert(Object.assign(new Error('boom'), { code: 121 }));
        await assert.rejects(getCart(user._id), /boom/);

        patchInsert(Object.assign(new Error('dup'), { code: 11000 }));
        await assert.rejects(getCart(user._id), /dup/);
      } finally {
        restore();
      }

      // The real race path still recovers: the competing cart exists.
      await CartModel.create({ user: user._id, items: [] });
      const view = await getCart(user._id);
      assert.deepEqual(view.items, []);
      assert.equal(await CartModel.countDocuments({ user: user._id }).exec(), 1);
    });
  });

  // ---- R1 (P1): archived variant restoration ------------------------------
  describe('R1 — archived variant restoration', () => {
    it('serialises repeated restores and concurrent restore/delete without losing history or stock', async () => {
      for (let round = 0; round < 4; round += 1) {
        await resetTestDatabase();
        const fixture = await makeFixture({ stock: 5 });
        await addItem(fixture.user._id, fixture.variant.toString(), 1);
        const historical = await placeOrder(fixture.user);
        await deleteVariant(fixture.variant.toString());
        const repeated = await Promise.all([
          restoreVariant(fixture.variant.toString()), restoreVariant(fixture.variant.toString()),
        ]);
        assert.equal(repeated[0]?.id, repeated[1]?.id);
        await deleteVariant(fixture.variant.toString());
        await Promise.all([restoreVariant(fixture.variant.toString()), deleteVariant(fixture.variant.toString())]);
        const variant = await VariantModel.findById(fixture.variant).lean().exec();
        assert.ok(variant);
        assert.equal(variant.sku, fixture.sku);
        assert.equal(variant.stock, 4);
        assert.equal(await VariantModel.countDocuments({ product: fixture.product }), 1);
        assert.equal((await OrderModel.findById(historical.id))?.items[0]?.variant.toString(), fixture.variant.toString());
        await cancelOrder(fixture.user, historical.id);
        assert.equal(await stockOf(fixture.variant), 5);
      }
    });

    it('refuses an orphaned variant with HTTP-style conflict and preserves the archived document', async () => {
      const fixture = await makeFixture();
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      await ProductModel.deleteOne({ _id: fixture.product });
      await assert.rejects(restoreVariant(fixture.variant.toString()), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        return true;
      });
      assert.ok((await VariantModel.findById(fixture.variant))?.archivedAt);
      assert.equal(await stockOf(fixture.variant), 10);
    });

    it('keeps draft and archived parents unpublished and retains full unique indexes', async () => {
      const fixture = await makeFixture();
      for (const status of ['draft', 'archived'] as const) {
        await ProductModel.updateOne({ _id: fixture.product }, { $set: { status } });
        await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
        await assert.rejects(createVariant(fixture.product.toString(), {
          sku: `${fixture.sku}-DUP`, size: 'M', color: null, stock: 1, lowStockThreshold: 5, images: [],
        }), (error: unknown) => error instanceof AppError && error.statusCode === 409);
        await restoreVariant(fixture.variant.toString());
        assert.equal((await ProductModel.findById(fixture.product))?.status, status);
      }
      const indexes = await VariantModel.collection.indexes();
      const combo = indexes.find((index) => index.key.product === 1 && index.key.size === 1 && index.key.color === 1);
      assert.equal(combo?.unique, true);
      assert.equal(combo?.partialFilterExpression, undefined);
    });

    it('cannot leave a restored orphan when product deletion races restoration', async () => {
      const fixture = await makeFixture();
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      const [, deletion] = await Promise.allSettled([
        restoreVariant(fixture.variant.toString()), deleteProduct(fixture.product.toString()),
      ]);
      assert.equal(deletion.status, 'fulfilled');
      assert.equal(await ProductModel.findById(fixture.product), null);
      assert.equal(await VariantModel.findById(fixture.variant), null);
    });
    it('restores the same document and the variant becomes sellable again', async () => {
      const fixture = await makeFixture({ stock: 4 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const historical = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 3);

      const archived = await deleteVariant(fixture.variant.toString());
      assert.equal(archived.archived, true);

      const restored = await restoreVariant(fixture.variant.toString());
      assert.equal(restored.id, fixture.variant.toString(), 'same _id');
      assert.equal(restored.sku, fixture.sku, 'same SKU');
      assert.equal(restored.stock, 3, 'stock preserved');
      assert.equal(restored.archivedAt, null);

      // Sellable again: the cart accepts it and a new checkout succeeds.
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const reordered = await placeOrder(fixture.user);
      assert.equal(reordered.items[0]?.variant, fixture.variant.toString());
      assert.equal(await stockOf(fixture.variant), 2);

      // The historical order still restores exactly its own quantity.
      const cancelled = await cancelOrder(fixture.user, historical.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 3);
    });

    it('is idempotent for an already-active variant', async () => {
      const fixture = await makeFixture({ stock: 2 });
      const before = await VariantModel.findById(fixture.variant).lean().exec();

      const first = await restoreVariant(fixture.variant.toString());
      const second = await restoreVariant(fixture.variant.toString());

      assert.equal(first.id, second.id);
      const after = await VariantModel.findById(fixture.variant).lean().exec();
      assert.equal(after?._id.toString(), before?._id.toString());
      assert.equal(after?.stock, 2);
      assert.equal(after?.archivedAt, null);
      assert.equal(await VariantModel.countDocuments({ product: fixture.product }).exec(), 1);
    });

    it('restores a variant referenced by a historical order without breaking cancellation', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      await deleteVariant(fixture.variant.toString());
      await restoreVariant(fixture.variant.toString());

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 5, 'restored exactly once');
    });

    it('serialises a restore against a concurrent checkout', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      // An existing order makes deletion archive the variant instead of deleting it.
      const first = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 4);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await deleteVariant(fixture.variant.toString());

      const [restoreResult, orderResult] = await Promise.allSettled([
        restoreVariant(fixture.variant.toString()),
        placeOrder(fixture.user),
      ]);

      assert.equal(restoreResult.status, 'fulfilled', 'restore is never lost in the race');
      const variant = await VariantModel.findById(fixture.variant).lean().exec();
      assert.ok(variant, 'the variant document always survives');
      assert.equal(variant?._id.toString(), fixture.variant.toString());
      assert.equal(variant?.archivedAt, null, 'restore wins or is retried until it applies');

      const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();
      if (orderResult.status === 'fulfilled') {
        assert.equal(orders.length, 2);
        assert.equal(await stockOf(fixture.variant), 3, 'decremented exactly once');
      } else {
        assert.equal(orders.length, 1);
        assert.equal(await stockOf(fixture.variant), 4, 'no decrement for the rejected checkout');
        assert.ok(variant && variant.stock >= 0);
      }

      // Cleanup proof: the historical order still cancels correctly.
      await cancelOrder(fixture.user, first.id);
    });
  });

  // ---- P3: stock restoration success criterion ----------------------------
  describe('R4 — restore treats a zero-change update as success', () => {
    it('cancels an order whose line has quantity 0 without a false restore failure', async () => {
      const fixture = await makeFixture({ stock: 4 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 3);

      // Corrupt/legacy data: a zero-quantity line ($inc: 0 matches but does not modify).
      await OrderModel.collection.updateOne(
        { _id: new Types.ObjectId(order.id) },
        { $set: { 'items.0.quantity': 0 } },
      );

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 3, 'nothing to restore, nothing broken');
    });
  });

  for (const actor of ['customer', 'admin'] as const) {
    const cancel = (user: UserDocument, id: string) => actor === 'customer'
      ? cancelOrder(user, id)
      : adminUpdateOrderStatus(user, id, { status: 'cancelled' });

    describe(`R4 — ${actor} cancellation invariants`, () => {
      it('accepts a matched zero-change result and prevents a second restoration', async (t) => {
        const fixture = await makeFixture({ stock: 4 });
        await addItem(fixture.user._id, fixture.variant.toString(), 1);
        const order = await placeOrder(fixture.user);
        await OrderModel.collection.updateOne({ _id: new Types.ObjectId(order.id) }, { $set: { 'items.0.quantity': 0 } });
        // Force the driver's legitimate matched-but-unmodified result. Mongoose
        // timestamps could otherwise make a real $inc:0 report a modification.
        t.mock.method(VariantModel, 'updateOne', (() => ({ exec: async () => ({ matchedCount: 1, modifiedCount: 0 }) })) as unknown as typeof VariantModel.updateOne);
        assert.equal((await cancel(fixture.user, order.id)).status, 'cancelled');
        await assert.rejects(cancel(fixture.user, order.id), (error: unknown) => error instanceof AppError && error.statusCode === 409);
        assert.equal(await stockOf(fixture.variant), 3);
        assert.equal((await OrderModel.findById(order.id))?.stockRestored, true);
      });

      it('rolls back earlier inventory and the status when a later variant is missing', async () => {
        const fixture = await makeFixture({ stock: 6 });
        const second = await addSecondVariant(fixture, 5);
        await addItem(fixture.user._id, fixture.variant.toString(), 2);
        await addItem(fixture.user._id, second.toString(), 1);
        const order = await placeOrder(fixture.user);
        await VariantModel.deleteOne({ _id: second });
        await assert.rejects(cancel(fixture.user, order.id), (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'STOCK_RESTORE_FAILED');
          assert.equal(error.statusCode, 409);
          return true;
        });
        assert.equal(await stockOf(fixture.variant), 4, 'the earlier stock increment was rolled back');
        const stored = await OrderModel.findById(order.id);
        assert.equal(stored?.status, 'pending');
        assert.equal(stored?.stockRestored, false);
        assert.equal(stored?.statusHistory.length, 1);
      });
    });
  }

  describe('HTTP — checkout conflicts and restore authorization', () => {
    const request = (user: UserDocument | null, path: string, method: string, body?: unknown) => fetch(`${origin}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: `al_token=${signAuthToken(user._id.toString(), user.role)}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const checkout = (user: UserDocument) => request(user, '/orders', 'POST', {
      checkoutId: randomUUID(), paymentMethod: 'cod', shippingAddress: {
        fullName: 'P0 Test User', phone: '01700000000', line1: 'House 1, Road 1', isDefault: true,
      },
    });

    it('deletes an unreferenced product and its variants only after admin authorization', async () => {
      const fixture = await makeFixture();
      const path = `/admin/products/${fixture.product}`;
      assert.equal((await request(null, path, 'DELETE')).status, 401);
      assert.equal((await request(fixture.user, path, 'DELETE')).status, 403);
      assert.ok(await ProductModel.exists({ _id: fixture.product }));
      fixture.user.role = 'admin'; await fixture.user.save();
      assert.equal((await request(fixture.user, path, 'DELETE')).status, 204);
      assert.equal(await ProductModel.exists({ _id: fixture.product }), null);
      assert.equal(await VariantModel.countDocuments({ product: fixture.product }), 0);
      assert.equal((await request(fixture.user, path, 'DELETE')).status, 404);
    });

    it('archives an ordered product through DELETE and preserves cancellation stock targets', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await placeOrder(fixture.user);
      const before = JSON.stringify((await OrderModel.findById(order.id))?.items);
      fixture.user.role = 'admin'; await fixture.user.save();
      const response = await request(fixture.user, `/admin/products/${fixture.product}`, 'DELETE');
      assert.equal(response.status, 200);
      const body = await response.json() as { archived: boolean; orders: number };
      assert.equal(body.archived, true); assert.equal(body.orders, 1);
      assert.equal((await ProductModel.findById(fixture.product))?.status, 'archived');
      assert.ok(await VariantModel.exists({ _id: fixture.variant }));
      await cancelOrder(fixture.user, order.id);
      assert.equal(await stockOf(fixture.variant), 5);
      assert.equal(JSON.stringify((await OrderModel.findById(order.id))?.items), before);
    });

    it('deletes empty categories and reports dependencies without deleting occupied categories', async () => {
      const fixture = await makeFixture();
      const product = await ProductModel.findById(fixture.product); assert.ok(product);
      const occupied = `/admin/categories/${product.category}`;
      assert.equal((await request(null, occupied, 'DELETE')).status, 401);
      assert.equal((await request(fixture.user, occupied, 'DELETE')).status, 403);
      fixture.user.role = 'admin'; await fixture.user.save();
      const blocked = await request(fixture.user, occupied, 'DELETE');
      assert.equal(blocked.status, 409);
      const blockedMessage = (await blocked.json() as { error: { message: string } }).error.message;
      assert.match(blockedMessage, /1 product/);
      assert.match(blockedMessage, /draft and archived products/);
      assert.ok(await CategoryModel.exists({ _id: product.category }));
      const parent = await CategoryModel.create({ name: 'Delete parent', slug: unique('delete-parent') });
      const child = await CategoryModel.create({ name: 'Delete child', slug: unique('delete-child'), parent: parent._id });
      const response = await request(fixture.user, `/admin/categories/${parent._id}`, 'DELETE');
      assert.equal(response.status, 409);
      assert.match((await response.json() as { error: { message: string } }).error.message, /1 subcategory/);
      assert.equal((await request(fixture.user, `/admin/categories/${child._id}`, 'DELETE')).status, 204);
      assert.equal((await request(fixture.user, `/admin/categories/${parent._id}`, 'DELETE')).status, 204);
      assert.equal((await request(fixture.user, `/admin/categories/${parent._id}`, 'DELETE')).status, 404);
    });

    it('returns 409 CART_NOT_ORDERABLE with per-line details', async () => {
      const fixture = await makeFixture();
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      const response = await checkout(fixture.user);
      assert.equal(response.status, 409);
      const body = await response.json() as { error: { code: string; details: unknown[] } };
      assert.equal(body.error.code, 'CART_NOT_ORDERABLE');
      assert.ok(body.error.details.length > 0);
      assert.equal(await OrderModel.countDocuments(), 0);
      assert.equal(await stockOf(fixture.variant), 10);
    });
    it('protects profile/address endpoints and admin search from unauthenticated or non-admin access', async () => {
      const fixture = await makeFixture();
      assert.equal((await request(null, '/users/me', 'PATCH', { name: 'New' })).status, 401);
      assert.equal((await request(fixture.user, '/users/me', 'PATCH', { name: '' })).status, 400);
      assert.equal((await request(fixture.user, '/users/me', 'PATCH', { name: 'New' })).status, 200);
      assert.equal((await request(fixture.user, '/users/me/addresses', 'POST', { fullName: 'Customer', phone: 'invalid', line1: 'Dhaka' })).status, 400);
      const created = await request(fixture.user, '/users/me/addresses', 'POST', { fullName: 'Customer', phone: '+8801712345678', line1: 'Dhaka', isDefault: true });
      assert.equal(created.status, 201);
      const address = (await created.json() as { address: { _id: string } }).address;
      const other = await makeFixture();
      assert.equal((await request(other.user, `/users/me/addresses/${address._id}`, 'PATCH', { line1: 'Wrong owner' })).status, 404);
      assert.equal((await request(other.user, `/users/me/addresses/${address._id}`, 'DELETE')).status, 404);
      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'PATCH', { line1: 'Updated' })).status, 200);
      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'PATCH', { label: 'Home', line2: 'Flat 4', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' })).status, 200);
      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'PATCH', { label: '', line2: '', city: '', state: '', postalCode: '', country: '' })).status, 200);
      const clearedAddress = (await UserModel.findById(fixture.user._id))?.addresses.find((item) => item._id?.toString() === address._id);
      for (const field of ['label', 'line2', 'city', 'state', 'postalCode', 'country'] as const) assert.equal(clearedAddress?.[field], '');
      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'DELETE')).status, 204);
      assert.equal((await request(null, '/admin/orders?search=01700000000', 'GET')).status, 401);
      assert.equal((await request(fixture.user, '/admin/orders?search=01700000000', 'GET')).status, 403);
      fixture.user.role = 'admin'; await fixture.user.save();
      assert.equal((await request(fixture.user, '/admin/orders?search=.*', 'GET')).status, 400);
      assert.equal((await request(fixture.user, '/admin/orders?search=01700000000', 'GET')).status, 200);
    });

    it('returns 409 CHECKOUT_IN_PROGRESS without changing stock', async () => {
      const fixture = await makeFixture();
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await CartModel.updateOne({ user: fixture.user._id }, { $set: { checkoutInProgress: new Date() } });
      const response = await checkout(fixture.user);
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'CHECKOUT_IN_PROGRESS');
      assert.equal(await stockOf(fixture.variant), 10);
      assert.equal(await OrderModel.countDocuments(), 0);
    });

    it('returns 409 CHECKOUT_CONFLICT and rolls back stock, order and cart clearing', async (t) => {
      const fixture = await makeFixture();
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const original = CartModel.updateOne.bind(CartModel);
      t.mock.method(CartModel, 'updateOne', ((...args: unknown[]) => {
        const update = args[1] as { $set?: { items?: unknown } };
        if (Array.isArray(update.$set?.items)) return { exec: async () => ({ matchedCount: 0 }) };
        return Reflect.apply(original, CartModel, args);
      }) as typeof CartModel.updateOne);
      const response = await checkout(fixture.user);
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'CHECKOUT_CONFLICT');
      assert.equal(await stockOf(fixture.variant), 10);
      assert.equal(await OrderModel.countDocuments(), 0);
      const cart = await CartModel.findOne({ user: fixture.user._id });
      assert.equal(cart?.items.length, 1);
      assert.equal(cart?.checkoutInProgress, null);
    });

    it('requires admin authentication, validates ids and restores through the real route', async () => {
      const fixture = await makeFixture();
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      const path = `/admin/variants/${fixture.variant.toString()}/restore`;
      assert.equal((await request(null, path, 'PATCH')).status, 401);
      assert.equal((await request(fixture.user, path, 'PATCH')).status, 403);
      assert.ok((await VariantModel.findById(fixture.variant))?.archivedAt);
      fixture.user.role = 'admin';
      await fixture.user.save();
      assert.equal((await request(fixture.user, '/admin/variants/invalid/restore', 'PATCH')).status, 400);
      const response = await request(fixture.user, path, 'PATCH');
      assert.equal(response.status, 200);
      const body = await response.json() as { variant: { id: string; archivedAt: null; stock: number; sku: string } };
      assert.equal(body.variant.id, fixture.variant.toString());
      assert.equal(body.variant.archivedAt, null);
      assert.equal(body.variant.stock, 10);
      assert.equal(body.variant.sku, fixture.sku);
    });
  });
});
