import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import {
  ActivityEventModel,
  type ActivityEvent,
} from '../src/models/activity-event.model.js';
import { CartModel } from '../src/models/cart.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { AdminAccessAuditModel } from '../src/models/admin-access-audit.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { signAuthToken } from '../src/utils/jwt.js';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';

/**
 * Phase 2 — admin activity reads: authorization matrix (T3), live panel,
 * feed filters/pagination/date ranges, customer timeline merge, and the
 * customer-view access audit on the identifiable timeline endpoint.
 */

let sequence = 0;
const unique = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

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

interface SeedEvent {
  type?: ActivityEvent['type'];
  source?: ActivityEvent['source'];
  ts?: Date;
  sessionId?: string;
  userId?: Types.ObjectId;
  path?: string;
}

const seedEvent = async (event: SeedEvent = {}): Promise<string> => {
  const doc = await ActivityEventModel.create({
    eventId: randomUUID(),
    type: event.type ?? 'page.view',
    source: event.source ?? 'client',
    ts: event.ts ?? new Date(),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.userId ? { userId: event.userId } : {}),
    ...(event.path ? { path: event.path } : {}),
    createdAt: new Date(),
  });
  return doc._id.toString();
};

const makeUser = async (role: 'customer' | 'admin', tag: string): Promise<UserDocument> =>
  UserModel.create({
    email: `${tag}-${unique('u')}@example.com`,
    name: `Phase2 ${role}`,
    role,
  });

const makeOrderWithHistory = async (
  user: UserDocument,
  status: 'pending' | 'processing' | 'delivered',
): Promise<void> => {
  await OrderModel.create({
    orderNumber: `AL-20261124-${unique('O').toUpperCase().slice(-8)}`,
    user: user._id,
    checkoutId: randomUUID(),
    items: [
      {
        product: new Types.ObjectId(),
        variant: new Types.ObjectId(),
        name: 'Phase2 Fixture',
        sku: `SKU-${unique('p2o')}`,
        unitPrice: 10000,
        quantity: 1,
        lineTotal: 10000,
      },
    ],
    shippingAddress: {
      fullName: 'Phase2 User',
      phone: '01700000000',
      line1: 'House 1, Road 1',
    },
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    subtotal: 10000,
    shippingFee: 0,
    total: 10000,
    status,
    statusHistory: [
      { status: 'pending', at: new Date(Date.now() - 3600_000) },
      ...(status !== 'pending'
        ? [{ status, at: new Date(Date.now() - 1800_000), by: new Types.ObjectId() }]
        : []),
    ],
    stockRestored: false,
  });
};

describe('Phase 2 — admin activity reads (disposable database)', () => {
  let server: Server | undefined;
  let origin: string;
  let admin: UserDocument;
  let customer: UserDocument;

  const get = async (path: string, cookie?: string): Promise<Response> =>
    fetch(`${origin}/api${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });

  before(async () => {
    await connectTestDatabase();
    await Promise.all([
      ActivityEventModel.syncIndexes(),
      UserModel.syncIndexes(),
      CartModel.syncIndexes(),
      OrderModel.syncIndexes(),
      // H-1 readiness gate on the timeline needs the audit indexes present.
      AdminAccessAuditModel.syncIndexes(),
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
    // Users are wiped by the reset — recreate them so requireAuth (which
    // re-reads the user from the DB on every request) stays valid.
    admin = await makeUser('admin', 'p2admin');
    customer = await makeUser('customer', 'p2cust');
  });

  after(async () => {
    setFlag(false);
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectTestDatabase();
  });

  const adminCookie = (): string => `al_token=${signAuthToken(admin._id.toString(), 'admin')}`;
  const customerCookie = (): string =>
    `al_token=${signAuthToken(customer._id.toString(), 'customer')}`;

  // ---- T3: authorization matrix -----------------------------------------
  for (const path of [
    '/admin/activity/live',
    '/admin/activity/recent',
    `/admin/activity/customers/${new Types.ObjectId().toString()}/timeline`,
  ]) {
    it(`authz ${path}: 401 anonymous, 403 customer, 200 admin`, async () => {
      assert.equal((await get(path)).status, 401, 'anonymous');
      assert.equal((await get(path, customerCookie())).status, 403, 'customer');
      const adminRes = await get(path, adminCookie());
      // Unknown customer id yields 404 (not 403/500) for the timeline path.
      assert.ok(
        adminRes.status === 200 || adminRes.status === 404,
        `admin status ${adminRes.status}`,
      );
    });
  }

  it('GET /admin/activity/recent rejects a non-admin with no event read surface elsewhere', async () => {
    // The only activity read paths are under /api/admin — verify one more
    // plausible public shape does not exist.
    const publicAttempt = await fetch(`${origin}/api/activity/recent`);
    assert.equal(publicAttempt.status, 404, 'no public activity read route');
  });

  // ---- live panel --------------------------------------------------------
  it('live panel counts recent distinct sessions, carts and open checkouts', async () => {
    const now = Date.now();
    // Two active sessions (one anonymous-with-session, one user) + one stale.
    await seedEvent({ sessionId: 'sess-aaaa-1111', path: '/products/x', ts: new Date(now - 5000) });
    await seedEvent({ sessionId: 'sess-aaaa-1111', path: '/cart', ts: new Date(now - 2000) });
    await seedEvent({ sessionId: 'sess-bbbb-2222', userId: customer._id, path: '/checkout', ts: new Date(now - 30_000) });
    await seedEvent({ sessionId: 'sess-old-9999', path: '/old', ts: new Date(now - 10 * 60_000) });

    // One cart with items, one actively claimed checkout.
    await CartModel.create({
      user: new Types.ObjectId(),
      items: [{ variant: new Types.ObjectId(), quantity: 2 }],
      version: 0,
    });
    await CartModel.create({
      user: new Types.ObjectId(),
      items: [{ variant: new Types.ObjectId(), quantity: 1 }],
      checkoutInProgress: new Date(),
      version: 0,
    });

    const response = await get('/admin/activity/live', adminCookie());
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      trackingEnabled: boolean;
      visitors5m: number;
      cartsWithItems: number;
      openCheckouts: number;
      sessions: Array<{ identity: string; path?: string; events: number }>;
      generatedAt: string;
      stale: boolean;
    };
    assert.equal(body.trackingEnabled, true);
    assert.equal(body.visitors5m, 2, 'only sessions with events in 5 minutes');
    assert.equal(body.cartsWithItems, 2, 'both seeded carts hold items');
    assert.equal(body.openCheckouts, 1, 'only the actively claimed cart');
    assert.equal(body.sessions.length, 2);
    const first = body.sessions[0];
    assert.ok(first);
    assert.equal(first.events, 2, 'latest session has two events');
    assert.equal(first.path, '/cart', 'path of the session\u2019s most recent event');
    assert.equal(body.stale, false);
    assert.ok(!Number.isNaN(Date.parse(body.generatedAt)));
  });

  it('live panel reports trackingEnabled=false while the flag is off', async () => {
    setFlag(false);
    const response = await get('/admin/activity/live', adminCookie());
    assert.equal(response.status, 200);
    const body = (await response.json()) as { trackingEnabled: boolean; visitors5m: number };
    assert.equal(body.trackingEnabled, false);
    assert.equal(body.visitors5m, 0, 'no events exist while disabled');
    setFlag(true);
  });

  // ---- recent feed -------------------------------------------------------
  it('recent feed paginates and filters by type, source, userId and date range', async () => {
    const now = Date.now();
    await seedEvent({ type: 'page.view', ts: new Date(now - 1000) });
    await seedEvent({ type: 'page.view', ts: new Date(now - 2000) });
    await seedEvent({ type: 'cart.add', ts: new Date(now - 3000) });
    await seedEvent({ type: 'order.purchased', source: 'server', userId: customer._id, ts: new Date(now - 4000) });
    await seedEvent({ type: 'page.view', ts: new Date(now - 48 * 3600_000) }); // older than 24h

    const page1 = await (
      await get('/admin/activity/recent?page=1&limit=2', adminCookie())
    ).json() as { items: unknown[]; page: number; limit: number; total: number; totalPages: number };
    assert.equal(page1.items.length, 2);
    assert.equal(page1.page, 1);
    assert.equal(page1.limit, 2);
    assert.equal(page1.total, 5);
    assert.equal(page1.totalPages, 3);

    const page3 = await (
      await get('/admin/activity/recent?page=3&limit=2', adminCookie())
    ).json() as { items: unknown[] };
    assert.equal(page3.items.length, 1, 'remainder on last page');

    const filtered = await (
      await get('/admin/activity/recent?type=cart.add', adminCookie())
    ).json() as { items: Array<{ type: string }>; total: number };
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0]?.type, 'cart.add');

    const bySource = await (
      await get('/admin/activity/recent?source=server', adminCookie())
    ).json() as { total: number };
    assert.equal(bySource.total, 1);

    const byUser = await (
      await get(`/admin/activity/recent?userId=${customer._id.toString()}`, adminCookie())
    ).json() as { total: number };
    assert.equal(byUser.total, 1);

    const ranged = await (
      await get(
        `/admin/activity/recent?from=${new Date(now - 60_000).toISOString()}&to=${new Date(now).toISOString()}`,
        adminCookie(),
      )
    ).json() as { total: number };
    assert.equal(ranged.total, 4, 'the 48h-old event excluded by range');

    const badDate = await get('/admin/activity/recent?from=not-a-date', adminCookie());
    assert.equal(badDate.status, 400, 'invalid date rejected');
    const badType = await get('/admin/activity/recent?type=order.purchased', adminCookie());
    assert.equal(badType.status, 200, 'server type is in the closed enum');
    const unknownType = await get('/admin/activity/recent?type=hacked.event', adminCookie());
    assert.equal(unknownType.status, 400, 'unknown type rejected');
  });

  // ---- customer timeline ------------------------------------------------
  it('timeline merges activity events with authoritative order history, date-filtered', async () => {
    const now = Date.now();
    await seedEvent({ userId: customer._id, type: 'page.view', path: '/products/a', ts: new Date(now - 5000) });
    await seedEvent({ userId: customer._id, type: 'cart.add', ts: new Date(now - 4000) });
    const other = await makeUser('customer', 'p2other');
    await seedEvent({ userId: other._id, type: 'page.view', ts: new Date(now - 3000) });
    await makeOrderWithHistory(customer, 'processing');

    const response = await get(
      `/admin/activity/customers/${customer._id.toString()}/timeline`,
      adminCookie(),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      user: { id: string; email: string };
      activity: { items: Array<{ type: string; userId?: string }>; total: number };
      orderHistory: Array<{ status: string; orderNumber: string; at: string; by?: string }>;
    };
    assert.equal(body.user.id, customer._id.toString());
    assert.equal(body.activity.total, 2, "only this customer's events");
    for (const item of body.activity.items) {
      assert.equal(item.userId, customer._id.toString());
    }
    assert.ok(body.orderHistory.length >= 2, 'pending + processing entries');
    assert.ok(body.orderHistory.some((entry) => entry.status === 'processing' && entry.by));
    // Newest first.
    const times = body.orderHistory.map((entry) => Date.parse(entry.at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));

    // Date filter excludes everything when the window is in the past.
    const empty = await (
      await get(
        `/admin/activity/customers/${customer._id.toString()}/timeline?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z`,
        adminCookie(),
      )
    ).json() as { activity: { total: number }; orderHistory: unknown[] };
    assert.equal(empty.activity.total, 0, 'activity respects the date window');
  });

  it('timeline for an unknown customer is a generic 404', async () => {
    const response = await get(
      `/admin/activity/customers/${new Types.ObjectId().toString()}/timeline`,
      adminCookie(),
    );
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'NOT_FOUND');
  });

  it('timeline access is audited (admin.customer_viewed with actor + target)', async () => {
    const response = await get(
      `/admin/activity/customers/${customer._id.toString()}/timeline`,
      adminCookie(),
    );
    assert.equal(response.status, 200);

    const audited = await waitFor(async () =>
      Boolean(await ActivityEventModel.findOne({ type: 'admin.customer_viewed' })),
    );
    assert.ok(audited, 'timeline view must emit the access audit');
    const event = await ActivityEventModel.findOne({ type: 'admin.customer_viewed' }).lean();
    assert.ok(event);
    assert.equal(event.userId?.toString(), admin._id.toString(), 'actor = admin');
    assert.equal(event.customerId?.toString(), customer._id.toString(), 'target = customer');
    assert.equal(event.source, 'server');
  });

  it('customer cookies cannot read any activity endpoint', async () => {
    assert.equal((await get('/admin/activity/live', customerCookie())).status, 403);
    assert.equal((await get('/admin/activity/recent', customerCookie())).status, 403);
    assert.equal(
      (
        await get(
          `/admin/activity/customers/${customer._id.toString()}/timeline`,
          customerCookie(),
        )
      ).status,
      403,
    );
    assert.equal(await ActivityEventModel.countDocuments({ type: 'admin.customer_viewed' }), 0);
  });

  // ---- L-4: truncation is disclosed --------------------------------------
  it('timeline flags a truncated order history instead of silently cutting it', async () => {
    // One order with 105 status changes (> ORDER_HISTORY_CAP = 100).
    await OrderModel.create({
      orderNumber: `AL-20261124-${unique('TRUNC').toUpperCase().slice(-8)}`,
      user: customer._id,
      checkoutId: randomUUID(),
      items: [
        {
          product: new Types.ObjectId(),
          variant: new Types.ObjectId(),
          name: 'Truncation Fixture',
          sku: `SKU-${unique('trunc')}`,
          unitPrice: 1000,
          quantity: 1,
          lineTotal: 1000,
        },
      ],
      shippingAddress: { fullName: 'T', phone: '01700000000', line1: 'Lane 1' },
      paymentMethod: 'cod',
      paymentStatus: 'unpaid',
      subtotal: 1000,
      shippingFee: 0,
      total: 1000,
      status: 'pending',
      statusHistory: Array.from({ length: 105 }, (_, index) => ({
        status: 'pending' as const,
        at: new Date(Date.now() - index * 1000),
      })),
      stockRestored: false,
    });

    const truncated = (await (
      await get(
        `/admin/activity/customers/${customer._id.toString()}/timeline`,
        adminCookie(),
      )
    ).json()) as { orderHistory: unknown[]; orderHistoryTruncated: boolean };
    assert.equal(truncated.orderHistory.length, 100, 'capped at ORDER_HISTORY_CAP');
    assert.equal(truncated.orderHistoryTruncated, true, 'truncation is disclosed');

    // A short history is not marked truncated.
    const short = await makeUser('customer', 'p2short');
    await OrderModel.create({
      orderNumber: `AL-20261124-${unique('SHORT').toUpperCase().slice(-8)}`,
      user: short._id,
      checkoutId: randomUUID(),
      items: [
        {
          product: new Types.ObjectId(),
          variant: new Types.ObjectId(),
          name: 'Short Fixture',
          sku: `SKU-${unique('short')}`,
          unitPrice: 1000,
          quantity: 1,
          lineTotal: 1000,
        },
      ],
      shippingAddress: { fullName: 'S', phone: '01700000000', line1: 'Lane 2' },
      paymentMethod: 'cod',
      paymentStatus: 'unpaid',
      subtotal: 1000,
      shippingFee: 0,
      total: 1000,
      status: 'pending',
      statusHistory: [{ status: 'pending' as const, at: new Date() }],
      stockRestored: false,
    });
    const notTruncated = (await (
      await get(`/admin/activity/customers/${short._id.toString()}/timeline`, adminCookie())
    ).json()) as { orderHistory: unknown[]; orderHistoryTruncated: boolean };
    assert.equal(notTruncated.orderHistory.length, 1);
    assert.equal(notTruncated.orderHistoryTruncated, false);
  });
});
