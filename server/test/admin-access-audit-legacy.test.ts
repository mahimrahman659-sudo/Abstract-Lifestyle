import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { invalidateAdminAccessAuditReadinessCache } from '../src/config/admin-access-audit-index.js';
import {
  AdminAccessAuditModel,
  type AdminAccessAuditAction,
} from '../src/models/admin-access-audit.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { AUDIT_WRITE_BUDGET_MS } from '../src/services/admin-access-audit.service.js';
import { signAuthToken } from '../src/utils/jwt.js';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';

/**
 * Phase 2C — durable audit for the four legacy customer/order admin
 * endpoints, behind ADMIN_ACCESS_AUDIT_LEGACY_ENABLED (default false).
 *
 * Covers §6: authz, audited list/detail for both entities, one record per
 * bulk request, empty/not-found outcomes, missing/mismatched indexes,
 * majority failure, bounded timeout, sanitized fail-closed, forged identity,
 * sensitive-data exclusion, concurrency, rollout flag on/off, timeline
 * audit preserved, (full checkout/payment regression via the full suite).
 */

let sequence = 0;
const unique = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

const setLegacy = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ADMIN_ACCESS_AUDIT_LEGACY_ENABLED = enabled;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const makeUser = async (role: 'customer' | 'admin', tag: string): Promise<UserDocument> =>
  UserModel.create({
    email: `${tag}-${unique('u')}@example.com`,
    name: `Phase2C ${role}`,
    role,
  });

const makeOrder = async (user: UserDocument): Promise<void> => {
  await OrderModel.create({
    orderNumber: `AL-20261126-${unique('P2C').toUpperCase().slice(-8)}`,
    user: user._id,
    checkoutId: randomUUID(),
    items: [
      {
        product: new Types.ObjectId(),
        variant: new Types.ObjectId(),
        name: 'Phase2C Fixture',
        sku: `SKU-${unique('p2c')}`,
        unitPrice: 5000,
        quantity: 1,
        lineTotal: 5000,
      },
    ],
    shippingAddress: { fullName: 'P2C User', phone: '01712345678', line1: 'Legacy lane 7' },
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    subtotal: 5000,
    shippingFee: 0,
    total: 5000,
    status: 'pending',
    statusHistory: [{ status: 'pending', at: new Date() }],
    stockRestored: false,
  });
};

interface LeanAuditRow {
  auditId: string;
  adminId: Types.ObjectId;
  action: AdminAccessAuditAction;
  targetCustomerId?: Types.ObjectId;
  targetOrderId?: Types.ObjectId;
  resultCount?: number;
  page?: number;
  at: Date;
  outcome: 'success' | 'not_found';
  correlationId: string;
}

describe('Phase 2C — legacy customer/order endpoint durable audit (disposable database)', () => {
  let server: Server | undefined;
  let origin: string;
  let admin: UserDocument;
  let customer: UserDocument;

  const adminCookie = (): string => `al_token=${signAuthToken(admin._id.toString(), 'admin')}`;
  const customerCookie = (): string =>
    `al_token=${signAuthToken(customer._id.toString(), 'customer')}`;

  const get = async (path: string, cookie?: string): Promise<Response> =>
    fetch(`${origin}/api${path}`, { headers: cookie ? { Cookie: cookie } : {} });

  const auditRows = async (): Promise<LeanAuditRow[]> =>
    AdminAccessAuditModel.find({}).lean().exec() as unknown as Promise<LeanAuditRow[]>;

  const auditCount = (): Promise<number> => AdminAccessAuditModel.countDocuments({}).exec();

  before(async () => {
    await connectTestDatabase();
    await Promise.all([
      AdminAccessAuditModel.syncIndexes(),
      UserModel.syncIndexes(),
      OrderModel.syncIndexes(),
    ]);
    invalidateAdminAccessAuditReadinessCache();
    setLegacy(false);
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase();
    invalidateAdminAccessAuditReadinessCache();
    setLegacy(false);
    admin = await makeUser('admin', 'p2c-admin');
    customer = await makeUser('customer', 'p2c-cust');
    await makeOrder(customer);
  });

  after(async () => {
    setLegacy(false);
    invalidateAdminAccessAuditReadinessCache();
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectTestDatabase();
  });

  const orderRoute = async (): Promise<string> => {
    const order = await OrderModel.findOne({ user: customer._id }).lean();
    assert.ok(order, 'fixture order exists');
    return `/admin/orders/${order._id.toString()}`;
  };

  // ---- unauthorized / non-admin (flag ON) --------------------------------
  it('rejects anonymous and non-admin requests on all four routes without audit rows', async () => {
    setLegacy(true);
    const routes = [
      '/admin/customers',
      `/admin/customers/${customer._id.toString()}`,
      '/admin/orders',
      await orderRoute(),
    ];
    for (const route of routes) {
      assert.equal((await get(route)).status, 401, `anon 401: ${route}`);
      assert.equal(
        (await get(route, customerCookie())).status,
        403,
        `non-admin 403: ${route}`,
      );
    }
    assert.equal(await auditCount(), 0, 'denials never write audit rows');
  });

  it('rollout flag OFF preserves existing behavior with zero audit dependency', async () => {
    setLegacy(false);
    const routes = [
      '/admin/customers',
      `/admin/customers/${customer._id.toString()}`,
      '/admin/orders',
      await orderRoute(),
    ];
    for (const route of routes) {
      const res = await get(route, adminCookie());
      assert.equal(res.status, 200, `flag off must keep serving: ${route}`);
      assert.equal(res.headers.get('x-audit-id'), null, 'no audit header pre-rollout');
    }
    assert.equal(await auditCount(), 0, 'flag off writes no audit rows');

    // Zero dependency on audit infrastructure while off: even with the
    // collection/indexes gone the four routes keep working.
    await AdminAccessAuditModel.collection.drop().catch(() => undefined);
    invalidateAdminAccessAuditReadinessCache();
    for (const route of routes) {
      assert.equal((await get(route, adminCookie())).status, 200, `no readiness dependency: ${route}`);
    }
    assert.equal(await auditCount(), 0);

    await AdminAccessAuditModel.syncIndexes();
    invalidateAdminAccessAuditReadinessCache();
  });

  // ---- audited success paths (flag ON) -----------------------------------
  it('audits customer LIST once per request with bounded metadata only', async () => {
    setLegacy(true);
    const before = await auditCount();
    const res = await get('/admin/customers?limit=10', adminCookie());
    assert.equal(res.status, 200);
    const rows = await auditRows();
    assert.equal(rows.length, before + 1, 'exactly ONE record per bulk request');
    const row = rows[rows.length - 1];
    assert.ok(row);
    assert.equal(row.action, 'customer.list.viewed');
    assert.equal(row.outcome, 'success');
    assert.match(String(row.auditId), UUID_V4);
    assert.match(String(row.correlationId), UUID_V4);
    assert.equal(res.headers.get('x-audit-id'), row.correlationId, 'header matches record');
    assert.equal(typeof row.resultCount, 'number', 'bounded bulk metadata present');
    assert.equal(row.page, 1);
    assert.equal(row.targetCustomerId, undefined, 'bulk records carry no target ids');
    assert.equal(row.targetOrderId, undefined);
    // No customer identity/search material in the record.
    const serialized = JSON.stringify(row);
    for (const secret of ['@', '01712345678', 'Legacy lane', 'p2c-cust']) {
      assert.ok(!serialized.includes(secret), `list row leaked "${secret}"`);
    }
  });

  it('audits customer DETAIL with only the necessary target identifier', async () => {
    setLegacy(true);
    const res = await get(`/admin/customers/${customer._id.toString()}`, adminCookie());
    assert.equal(res.status, 200);
    const rows = await auditRows();
    const row = rows[rows.length - 1];
    assert.ok(row);
    assert.equal(row.action, 'customer.detail.viewed');
    assert.equal(row.targetCustomerId?.toString(), customer._id.toString());
    assert.equal(row.targetOrderId, undefined);
    assert.equal(row.resultCount, undefined, 'individual access carries no bulk metadata');
    assert.equal(res.headers.get('x-audit-id'), row.correlationId);
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes('@'), 'detail row must not store the e-mail');
    assert.ok(!serialized.includes(customer.email));
  });

  it('audits order LIST with resultCount/page and no order or customer data', async () => {
    setLegacy(true);
    const res = await get('/admin/orders?limit=10', adminCookie());
    assert.equal(res.status, 200);
    const rows = await auditRows();
    const row = rows[rows.length - 1];
    assert.ok(row);
    assert.equal(row.action, 'order.list.viewed');
    assert.equal(typeof row.resultCount, 'number');
    assert.equal(row.page, 1);
    assert.equal(row.targetOrderId, undefined, 'bulk records carry no id lists or targets');
    const serialized = JSON.stringify(row);
    for (const secret of ['AL-', '01712345678', 'Legacy lane', '@']) {
      assert.ok(!serialized.includes(secret), `order list row leaked "${secret}"`);
    }
  });

  it('audits order DETAIL with only the necessary target identifier', async () => {
    setLegacy(true);
    const route = await orderRoute();
    const orderId = route.split('/').pop() as string;
    const res = await get(route, adminCookie());
    assert.equal(res.status, 200);
    const rows = await auditRows();
    const row = rows[rows.length - 1];
    assert.ok(row);
    assert.equal(row.action, 'order.detail.viewed');
    assert.equal(row.targetOrderId?.toString(), orderId);
    assert.equal(row.targetCustomerId, undefined);
    assert.equal(res.headers.get('x-audit-id'), row.correlationId);
    const serialized = JSON.stringify(row);
    for (const secret of ['01712345678', 'Legacy lane', '@', 'AL-']) {
      assert.ok(!serialized.includes(secret), `order detail row leaked "${secret}"`);
    }
  });

  it('audits an EMPTY result list as success with a zero count', async () => {
    setLegacy(true);
    const res = await get('/admin/customers?search=definitely-no-match-xyz', adminCookie());
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    assert.equal(body.items.length, 0);
    assert.equal(body.total, 0);
    const rows = await auditRows();
    const row = rows[rows.length - 1];
    assert.ok(row);
    assert.equal(row.outcome, 'success');
    assert.equal(row.resultCount, 0, 'empty page still audited with count 0');
  });

  it('audits not_found BEFORE returning 404 for both detail routes', async () => {
    setLegacy(true);
    const missingOrder = await get(`/admin/orders/${new Types.ObjectId().toString()}`, adminCookie());
    assert.equal(missingOrder.status, 404);
    let rows = await auditRows();
    let row = rows[rows.length - 1];
    assert.ok(row);
    assert.equal(row.action, 'order.detail.viewed');
    assert.equal(row.outcome, 'not_found');
    assert.ok(row.targetOrderId, 'attempt recorded against the requested id');

    const missingCustomer = await get(
      `/admin/customers/${new Types.ObjectId().toString()}`,
      adminCookie(),
    );
    assert.equal(missingCustomer.status, 404);
    rows = await auditRows();
    row = rows[rows.length - 1];
    assert.ok(row);
    assert.equal(row.action, 'customer.detail.viewed');
    assert.equal(row.outcome, 'not_found');
    assert.ok(missingOrder.headers.get('x-audit-id'), 'correlation echoed on audited 404');
  });

  // ---- readiness / majority / timeout fail-closed -------------------------
  it('missing audit indexes fail closed (503) while enforcement is ON, then recover', async () => {
    setLegacy(true);
    await AdminAccessAuditModel.collection.drop().catch(() => undefined);
    invalidateAdminAccessAuditReadinessCache();

    const gated = await get('/admin/orders', adminCookie());
    assert.equal(gated.status, 503, 'readiness gate fails closed');
    const text = await gated.text();
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
    assert.ok((parsed.error?.message ?? '').includes('not ready'));
    for (const secret of ['AL-', '@', '01712345678']) {
      assert.ok(!text.includes(secret), `503 leaked "${secret}"`);
    }
    assert.equal(gated.headers.get('x-audit-id'), null);

    await AdminAccessAuditModel.syncIndexes();
    invalidateAdminAccessAuditReadinessCache();
    assert.equal((await get('/admin/orders', adminCookie())).status, 200, 'recovery');
  });

  it('majority acknowledgment failure withholds data (sanitized 503)', async () => {
    setLegacy(true);
    const model = AdminAccessAuditModel as unknown as {
      create: typeof AdminAccessAuditModel.create;
    };
    const original = model.create;
    model.create = (async () => {
      const error = new Error(
        'Not enough data-bearing nodes to satisfy write concern w:majority',
      ) as Error & { name: string };
      error.name = 'MongoServerError';
      throw error;
    }) as typeof AdminAccessAuditModel.create;
    try {
      const res = await get('/admin/customers', adminCookie());
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.ok(!text.includes('@'), 'majority failure leaked no data');
      assert.equal(res.headers.get('x-audit-id'), null);
      const parsed = JSON.parse(text) as { error?: { code?: string } };
      assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
    } finally {
      model.create = original;
    }
    assert.equal((await get('/admin/customers', adminCookie())).status, 200, 'recovery');
  });

  it('bounded audit budget: a hung write fails closed within the window (measured)', async () => {
    setLegacy(true);
    const model = AdminAccessAuditModel as unknown as {
      create: typeof AdminAccessAuditModel.create;
    };
    const original = model.create;
    model.create = (() => new Promise(() => {})) as typeof AdminAccessAuditModel.create;
    try {
      const started = Date.now();
      const res = await get('/admin/customers', adminCookie());
      const elapsed = Date.now() - started;
      assert.equal(res.status, 503, 'hung write must fail closed');
      assert.equal(res.headers.get('x-audit-id'), null, 'no header for ambiguous outcome');
      const text = await res.text();
      assert.ok(!text.includes('@'), 'timeout response leaked no data');
      assert.ok(elapsed >= AUDIT_WRITE_BUDGET_MS - 500, `waited ~budget (got ${elapsed}ms)`);
      assert.ok(elapsed <= AUDIT_WRITE_BUDGET_MS + 5_000, `bounded wait (got ${elapsed}ms)`);
    } finally {
      model.create = original;
    }
    assert.equal((await get('/admin/customers', adminCookie())).status, 200, 'recovery');
  });

  // ---- forged identity ----------------------------------------------------
  it('rejects a forged administrator identity without audit rows', async () => {
    setLegacy(true);
    const forged = jwt.sign(
      { sub: admin._id.toString(), role: 'admin' },
      'not-the-server-secret',
      { expiresIn: '1h' },
    );
    const res = await get('/admin/customers', `al_token=${forged}`);
    assert.equal(res.status, 401);
    assert.equal(await auditCount(), 0);
  });

  // ---- concurrency --------------------------------------------------------
  it('concurrent requests each produce one distinct audit record', async () => {
    setLegacy(true);
    const before = await auditCount();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => get('/admin/orders', adminCookie())),
    );
    for (const res of responses) {
      assert.equal(res.status, 200);
    }
    assert.equal(await auditCount(), before + 4, 'one record per request');
    const ids = await AdminAccessAuditModel.distinct('auditId');
    assert.equal(ids.length, new Set(ids).size, 'unique audit identifiers');
  });

  // ---- timeline audit preserved ------------------------------------------
  it('timeline audit stays mandatory regardless of the legacy rollout flag', async () => {
    setLegacy(false);
    const res = await get(
      `/admin/activity/customers/${customer._id.toString()}/timeline`,
      adminCookie(),
    );
    assert.equal(res.status, 200, 'timeline works while legacy enforcement is off');
    const rows = await auditRows();
    const timelineRows = rows.filter((row) => row.action === 'customer.timeline.viewed');
    assert.equal(timelineRows.length, 1, 'timeline audit is NOT weakened by the flag');
    assert.equal(timelineRows[0]?.targetCustomerId?.toString(), customer._id.toString());
    // and the four legacy routes still wrote nothing.
    await get('/admin/customers', adminCookie());
    assert.equal(
      await AdminAccessAuditModel.countDocuments({ action: 'customer.list.viewed' }),
      0,
      'legacy routes unaudited while flag off (documented coverage gap)',
    );
  });
});
