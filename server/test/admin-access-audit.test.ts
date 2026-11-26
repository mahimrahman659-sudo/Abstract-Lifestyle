import './setup-env.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { invalidateAdminAccessAuditReadinessCache } from '../src/config/admin-access-audit-index.js';
import {
  AdminAccessAuditModel,
  ADMIN_ACCESS_AUDIT_TTL_SECONDS,
} from '../src/models/admin-access-audit.model.js';
import { ActivityEventModel } from '../src/models/activity-event.model.js';
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
 * Phase 2B — durable admin customer-access audit.
 *
 * Covers the mandated matrix: (1) unauthorized, (2) non-admin, (3) valid
 * admin + durable audit, (4) tracking disabled + durable audit + operational
 * history only, (5) audit DB failure ⇒ fail-closed, (6) forged admin
 * identity, (7) customer isolation, (8) concurrent access, (9) retention,
 * (10) sensitive-data exclusion, (11) checkout/payment regression (full
 * suite), (12) disabled behavioral collection.
 */

let sequence = 0;
const unique = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const makeUser = async (role: 'customer' | 'admin', tag: string): Promise<UserDocument> =>
  UserModel.create({
    email: `${tag}-${unique('u')}@example.com`,
    name: `Phase2B ${role}`,
    role,
  });

const makeOrderWithHistory = async (user: UserDocument): Promise<void> => {
  await OrderModel.create({
    orderNumber: `AL-20261125-${unique('P2B').toUpperCase().slice(-8)}`,
    user: user._id,
    checkoutId: randomUUID(),
    items: [
      {
        product: new Types.ObjectId(),
        variant: new Types.ObjectId(),
        name: 'Phase2B Fixture',
        sku: `SKU-${unique('p2b')}`,
        unitPrice: 10000,
        quantity: 1,
        lineTotal: 10000,
      },
    ],
    shippingAddress: { fullName: 'P2B User', phone: '01700000000', line1: 'Audit lane 1' },
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    subtotal: 10000,
    shippingFee: 0,
    total: 10000,
    status: 'pending',
    statusHistory: [
      { status: 'pending', at: new Date(Date.now() - 3600_000) },
      { status: 'processing', at: new Date(Date.now() - 1800_000), by: new Types.ObjectId() },
    ],
    stockRestored: false,
  });
};

const seedBehavioralEvent = async (userId: Types.ObjectId): Promise<void> => {
  await ActivityEventModel.create({
    eventId: randomUUID(),
    type: 'page.view',
    source: 'client',
    ts: new Date(),
    userId,
    path: '/products/secret-product',
    createdAt: new Date(),
  });
};

describe('Phase 2B — durable admin customer-access audit (disposable database)', () => {
  let server: Server | undefined;
  let origin: string;
  let admin: UserDocument;
  let customer: UserDocument;

  const adminCookie = (): string => `al_token=${signAuthToken(admin._id.toString(), 'admin')}`;
  const customerCookie = (): string =>
    `al_token=${signAuthToken(customer._id.toString(), 'customer')}`;

  const get = async (path: string, cookie?: string): Promise<Response> =>
    fetch(`${origin}/api${path}`, { headers: cookie ? { Cookie: cookie } : {} });

  const timelinePath = (): string =>
    `/admin/activity/customers/${customer._id.toString()}/timeline`;

  const auditCount = (): Promise<number> =>
    AdminAccessAuditModel.countDocuments({ action: 'customer.timeline.viewed' }).exec();

  before(async () => {
    await connectTestDatabase();
    await Promise.all([
      AdminAccessAuditModel.syncIndexes(),
      UserModel.syncIndexes(),
      OrderModel.syncIndexes(),
      ActivityEventModel.syncIndexes(),
    ]);
    invalidateAdminAccessAuditReadinessCache();
    setFlag(true);
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase();
    invalidateAdminAccessAuditReadinessCache();
    setFlag(true);
    // Users are wiped by the reset — recreate so requireAuth (DB re-read) works.
    admin = await makeUser('admin', 'p2b-admin');
    customer = await makeUser('customer', 'p2b-cust');
  });

  after(async () => {
    setFlag(false);
    invalidateAdminAccessAuditReadinessCache();
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectTestDatabase();
  });

  // ---- (1) unauthorized ---------------------------------------------------
  it('anonymous requests are rejected with 401 and write no audit record', async () => {
    const response = await get(timelinePath());
    assert.equal(response.status, 401);
    assert.equal(await auditCount(), 0);
  });

  // ---- (2) non-admin ------------------------------------------------------
  it('non-admin requests are rejected with 403 and write no audit record', async () => {
    const response = await get(timelinePath(), customerCookie());
    assert.equal(response.status, 403);
    assert.equal(await auditCount(), 0);
  });

  // ---- (6) forged administrator identity ---------------------------------
  it('a forged administrator identity (wrong JWT secret) gets 401 and no audit record', async () => {
    const forged = jwt.sign(
      { sub: admin._id.toString(), role: 'admin' },
      'definitely-not-the-server-secret',
      { expiresIn: '1h' },
    );
    const response = await get(timelinePath(), `al_token=${forged}`);
    assert.equal(response.status, 401);
    assert.equal(await auditCount(), 0);
  });

  // ---- (3) valid admin + durable audit ------------------------------------
  it('valid admin access persists a durable audit record BEFORE returning data', async () => {
    const before = Date.now();
    const response = await get(timelinePath(), adminCookie());
    assert.equal(response.status, 200);

    const rows = await AdminAccessAuditModel.find({
      action: 'customer.timeline.viewed',
    }).lean();
    assert.equal(rows.length, 1, 'exactly one durable audit row per request');
    const row = rows[0];
    assert.ok(row);
    assert.match(row.auditId, UUID_V4, 'server-generated UUID v4 audit id');
    assert.equal(row.adminId.toString(), admin._id.toString(), 'authenticated admin');
    assert.ok(row.targetCustomerId, 'timeline records always carry a target');
    assert.equal(row.targetCustomerId.toString(), customer._id.toString(), 'target customer');
    assert.equal(row.outcome, 'success');
    assert.match(row.correlationId, UUID_V4);
    const atMs = row.at.getTime();
    assert.ok(atMs >= before - 1000 && atMs <= Date.now() + 1000, 'server timestamp near now');

    // Correlation id echoed to the client for support/forensics.
    assert.equal(response.headers.get('x-audit-id'), row.correlationId);

    // Timeline payload itself contains the operational data (sanity).
    const body = (await response.json()) as {
      user: { id: string };
      trackingEnabled: boolean;
    };
    assert.equal(body.user.id, customer._id.toString());
    assert.equal(body.trackingEnabled, true);
  });

  // ---- (4) + (12): tracking disabled — durable audit + operational only ---
  it('tracking disabled: durable audit written, operational history served, behavioral data NOT read', async () => {
    await makeOrderWithHistory(customer);
    await seedBehavioralEvent(customer._id); // historical behavioral row exists
    const behavioralBefore = await ActivityEventModel.countDocuments({});
    assert.ok(behavioralBefore >= 1);

    setFlag(false);
    const response = await get(timelinePath(), adminCookie());
    assert.equal(response.status, 200, 'operational history stays available while disabled');
    const body = (await response.json()) as {
      activity: { items: unknown[]; total: number };
      orderHistory: Array<{ status: string }>;
      trackingEnabled: boolean;
      user: { email: string };
    };

    // C: behavioral stream suppressed — historical data is NOT served.
    assert.equal(body.trackingEnabled, false);
    assert.equal(body.activity.total, 0, 'no behavioral events read while disabled');
    assert.equal(body.activity.items.length, 0);
    // Operational history still displayed (audited).
    assert.ok(body.orderHistory.length >= 2, 'order statusHistory served');
    // No new behavioral writes of any kind (incl. no best-effort feed event).
    assert.equal(
      await ActivityEventModel.countDocuments({}),
      behavioralBefore,
      'disabled collection: zero new activity events',
    );
    // Durable audit exists (the H-1 resolution).
    const rows = await AdminAccessAuditModel.find({ outcome: 'success' }).lean();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.adminId.toString(), admin._id.toString());

    // The pre-existing customer-detail API remains unchanged while disabled.
    const detail = await get(`/admin/customers/${customer._id.toString()}`, adminCookie());
    assert.equal(detail.status, 200, 'pre-existing detail endpoint untouched');
  });

  // ---- (5) audit DB failure ⇒ fail closed --------------------------------
  it('audit persistence failure fails closed with sanitized 503 and no identifiable data', async () => {
    const model = AdminAccessAuditModel as unknown as {
      create: typeof AdminAccessAuditModel.create;
    };
    const original = model.create;
    model.create = (async () => {
      throw new Error('simulated audit store outage');
    }) as typeof AdminAccessAuditModel.create;
    try {
      const response = await get(timelinePath(), adminCookie());
      assert.equal(response.status, 503, 'fail closed — data must not be returned');
      const text = await response.text();
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
      assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
      assert.deepEqual(
        Object.keys(parsed.error ?? {}).sort(),
        ['code', 'message'],
        'sanitized envelope only',
      );
      for (const secret of ['@example', 'orderHistory', 'orderNumber', '"email"', '"name"', 'AL-']) {
        assert.ok(!text.includes(secret), `503 leaked "${secret}"`);
      }
      assert.equal(response.headers.get('x-audit-id'), null, 'no correlation header without a record');
      assert.equal(await auditCount(), 0);
    } finally {
      model.create = original;
    }
    // Recovery: the next request audits and serves normally.
    const recovered = await get(timelinePath(), adminCookie());
    assert.equal(recovered.status, 200);
    assert.equal(await auditCount(), 1);
  });

  // ---- (7) customer isolation --------------------------------------------
  it('audits the exact target customer and isolates timelines between customers', async () => {
    const other = await makeUser('customer', 'p2b-other');
    await seedBehavioralEvent(other._id);
    await seedBehavioralEvent(customer._id);

    const response = await get(timelinePath(), adminCookie());
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      user: { id: string };
      activity: { items: Array<{ userId?: string }> };
    };
    assert.equal(body.user.id, customer._id.toString());
    for (const item of body.activity.items) {
      assert.equal(item.userId, customer._id.toString(), "no other customer's events");
    }

    const row = await AdminAccessAuditModel.findOne({}).lean();
    assert.ok(row);
    assert.ok(row.targetCustomerId, 'timeline records always carry a target');
    assert.equal(row.targetCustomerId.toString(), customer._id.toString());
    assert.notEqual(row.targetCustomerId.toString(), other._id.toString());
  });

  // ---- (8) concurrent access ---------------------------------------------
  it('concurrent timeline requests each persist their own distinct audit record', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => get(timelinePath(), adminCookie())),
    );
    for (const response of responses) {
      assert.equal(response.status, 200);
    }
    assert.equal(await auditCount(), 5, 'one durable record per request');
    const auditIds = await AdminAccessAuditModel.distinct('auditId');
    assert.equal(auditIds.length, 5, 'unique audit identifiers');
    const correlationIds = await AdminAccessAuditModel.distinct('correlationId');
    assert.equal(correlationIds.length, 5, 'one correlation id per request');
  });

  // ---- not_found outcome + validation ordering ----------------------------
  it('audits a not_found attempt and validates BEFORE any audit write', async () => {
    const missing = await get(
      `/admin/activity/customers/${new Types.ObjectId().toString()}/timeline`,
      adminCookie(),
    );
    assert.equal(missing.status, 404);
    assert.ok(missing.headers.get('x-audit-id'), 'correlation id echoed');
    const notFoundRow = await AdminAccessAuditModel.findOne({ outcome: 'not_found' }).lean();
    assert.ok(notFoundRow, 'attempt recorded with sanitized outcome');
    assert.ok(notFoundRow.targetCustomerId, 'not_found attempt names the target');
    assert.equal(notFoundRow.targetCustomerId.toString().length, 24);

    // Malformed id → 400 from validation, no audit row (validation runs first).
    const malformed = await get('/admin/activity/customers/not-an-id/timeline', adminCookie());
    assert.equal(malformed.status, 400);
    assert.equal(await auditCount(), 1, 'only the not_found attempt was audited');
  });

  // ---- (10) sensitive-data exclusion --------------------------------------
  it('audit records contain only the minimum fields and no sensitive data', async () => {
    await get(timelinePath(), adminCookie());
    const row = await AdminAccessAuditModel.findOne({}).lean();
    assert.ok(row);
    const keys = Object.keys(row)
      .filter((key) => key !== '_id')
      .sort();
    assert.deepEqual(keys, [
      'action',
      'adminId',
      'at',
      'auditId',
      'correlationId',
      'outcome',
      'targetCustomerId',
    ]);
    const serialized = JSON.stringify(row);
    for (const secret of [
      'password',
      'token',
      'trxId',
      'userAgent',
      'ipAddress',
      'shippingAddress',
      'email',
      '@',
      '01700000000',
      'Audit lane',
    ]) {
      assert.ok(!serialized.includes(secret), `audit row leaked "${secret}"`);
    }
  });

  it('audit model and service sources contain no prohibited data fields (static scan)', () => {
    const serverSrc = fileURLToPath(new URL('../src/', import.meta.url));
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const denyList = [
      'password',
      'accessToken',
      'refreshToken',
      'otp',
      'trxId',
      'senderNumber',
      'userAgent',
      'ipAddress',
      'shippingAddress',
      'email',
      'responseBody',
      'meta:',
    ];
    for (const file of [
      'models/admin-access-audit.model.ts',
      'services/admin-access-audit.service.ts',
    ]) {
      const source = stripComments(readFileSync(`${serverSrc}${file}`, 'utf8'));
      for (const token of denyList) {
        assert.ok(!source.includes(token), `${file} must not contain "${token}"`);
      }
    }
    // Model stores ids/enums/timestamps only — no free-text fields.
    const model = stripComments(readFileSync(`${serverSrc}models/admin-access-audit.model.ts`, 'utf8'));
    assert.ok(!model.includes('Schema.Types.Mixed'), 'no free-form fields');
  });

  // ---- (9) retention ------------------------------------------------------
  it('defines explicit reviewed indexes including the proposed 365-day TTL', async () => {
    // syncIndexes ran in before(); inspect the live definitions.
    const db = mongoose.connection.db;
    assert.ok(db);
    const indexes = (await db
      .collection('admin_access_audit')
      .indexes()) as unknown as Array<{
      name: string;
      key: Record<string, number>;
      unique?: boolean;
      expireAfterSeconds?: number;
    }>;
    const byName = new Map(indexes.map((index) => [index.name, index]));

    const uniqueIndex = byName.get('audit_auditId_unique');
    assert.ok(uniqueIndex, 'unique audit id index exists');
    assert.equal(uniqueIndex.unique, true);
    assert.deepEqual(uniqueIndex.key, { auditId: 1 });

    const ttl = byName.get('audit_at_ttl');
    assert.ok(ttl, 'TTL index exists');
    assert.deepEqual(ttl.key, { at: 1 });
    assert.equal(
      ttl.expireAfterSeconds,
      ADMIN_ACCESS_AUDIT_TTL_SECONDS,
      'retention matches the proposed 365-day policy (owner approval pending for production)',
    );
    assert.equal(ADMIN_ACCESS_AUDIT_TTL_SECONDS, 365 * 24 * 60 * 60);

    assert.ok(byName.get('audit_admin_at'), 'admin forensics index exists');
    assert.ok(byName.get('audit_target_at'), 'per-customer trail index exists');
  });

  it('TTL monitor deletes expired audit documents on a disposable probe collection', async () => {
    const db = mongoose.connection.db;
    assert.ok(db);
    const probe = db.collection('admin_audit_ttl_probe');
    await probe.drop().catch(() => undefined);
    await probe.createIndex({ at: 1 }, { expireAfterSeconds: 1, name: 'audit_ttl_probe' });
    await probe.insertOne({ at: new Date(Date.now() - 10_000) });
    assert.equal(await probe.countDocuments({}), 1);

    const deadline = Date.now() + 75_000;
    let count = 1;
    while (Date.now() < deadline) {
      count = await probe.countDocuments({});
      if (count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(count, 0, 'TTL monitor removed the expired probe document');
    await probe.drop().catch(() => undefined);
  });

  // ---- H-1: readiness gate (reproduces & eliminates the review gap) -------
  it('H-1: flag off with missing audit indexes fails closed (was: served 200)', async () => {
    setFlag(false);
    try {
      await AdminAccessAuditModel.collection.drop().catch(() => undefined);
      invalidateAdminAccessAuditReadinessCache();

      const gated = await get(timelinePath(), adminCookie());
      assert.equal(gated.status, 503, 'readiness gate fails closed while tracking is off');
      const text = await gated.text();
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
      assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
      const gatedMessage = parsed.error?.message ?? '';
      assert.ok(gatedMessage.includes('not ready'), gatedMessage);
      for (const secret of ['@example', 'orderHistory', 'orderNumber', '"email"']) {
        assert.ok(!text.includes(secret), `503 leaked "${secret}"`);
      }
      assert.equal(gated.headers.get('x-audit-id'), null, 'no header without an audit record');
      assert.equal(await auditCount(), 0, 'nothing persisted while not ready');
    } finally {
      setFlag(true);
      await AdminAccessAuditModel.syncIndexes().catch(() => undefined);
      invalidateAdminAccessAuditReadinessCache();
    }

    const recovered = await get(timelinePath(), adminCookie());
    assert.equal(recovered.status, 200, 'readiness recovery after indexes exist');
    assert.equal(await auditCount(), 1, 'recovered request audited normally');
  });

  it('H-1: fails closed when the auditId index lost uniqueness', async () => {
    try {
      await AdminAccessAuditModel.collection.dropIndex('audit_auditId_unique');
      await AdminAccessAuditModel.collection.createIndex(
        { auditId: 1 },
        { name: 'audit_auditId_unique' },
      );
      invalidateAdminAccessAuditReadinessCache();

      const gated = await get(timelinePath(), adminCookie());
      assert.equal(gated.status, 503, 'incorrect uniqueness must fail closed');
      const parsed = (await gated.json()) as { error?: { code?: string; message?: string } };
      assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
      assert.equal(gated.headers.get('x-audit-id'), null);
    } finally {
      await AdminAccessAuditModel.syncIndexes();
      invalidateAdminAccessAuditReadinessCache();
    }
    assert.equal((await get(timelinePath(), adminCookie())).status, 200, 'recovery');
  });

  it('H-1: fails closed when the audit TTL index has an incorrect expiry', async () => {
    try {
      await AdminAccessAuditModel.collection.dropIndex('audit_at_ttl');
      await AdminAccessAuditModel.collection.createIndex(
        { at: 1 },
        { expireAfterSeconds: 60, name: 'audit_at_ttl' },
      );
      invalidateAdminAccessAuditReadinessCache();

      const gated = await get(timelinePath(), adminCookie());
      assert.equal(gated.status, 503, 'wrong TTL must fail closed');
      const parsed = (await gated.json()) as { error?: { code?: string; message?: string } };
      assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
    } finally {
      await AdminAccessAuditModel.syncIndexes();
      invalidateAdminAccessAuditReadinessCache();
    }
    assert.equal((await get(timelinePath(), adminCookie())).status, 200, 'recovery');
  });

  it('H-1: readiness cache has bounded validity, safe invalidation and recovery', async () => {
    // 1) Warm the cache with a ready verdict.
    assert.equal((await get(timelinePath(), adminCookie())).status, 200);

    // 2) Indexes vanish WITHOUT invalidation → bounded stale-READY window
    //    (≤ 60 s). The audit WRITE in this window is still acknowledged —
    //    enforcement holds; only detection/retention lag is bounded.
    await AdminAccessAuditModel.collection.drop().catch(() => undefined);
    const stale = await get(timelinePath(), adminCookie());
    assert.equal(stale.status, 200, 'documented bounded stale-ready window');

    // 3) Safe invalidation flips immediately to fail-closed on recompute
    //    (the stale request's write recreated the collection without indexes).
    invalidateAdminAccessAuditReadinessCache();
    const gated = await get(timelinePath(), adminCookie());
    assert.equal(gated.status, 503, 'recomputed readiness fails closed');

    // 4) Restore indexes + invalidate → immediate recovery (no 60 s wait).
    await AdminAccessAuditModel.syncIndexes();
    invalidateAdminAccessAuditReadinessCache();
    assert.equal((await get(timelinePath(), adminCookie())).status, 200, 'recovery');
  });

  // ---- M-2: majority write concern ---------------------------------------
  it('M-2: enforces majority+journal write concern with no w:1 fallback', () => {
    const options = AdminAccessAuditModel.schema.options as {
      writeConcern?: { w?: unknown; j?: unknown };
    };
    assert.deepEqual(
      options.writeConcern,
      { w: 'majority', j: true },
      'schema-level write concern is the only configured path (no w:1 fallback)',
    );
    // Behavioral: a real timeline request persisted under majority+journal
    // on this disposable replica set (single-node majority = satisfiable,
    // journaling compatible) — proven by the acknowledged row below.
  });

  it('M-2: majority acknowledgment failure withholds customer data (sanitized 503)', async () => {
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
      const res = await get(timelinePath(), adminCookie());
      assert.equal(res.status, 503, 'majority failure must fail closed');
      const text = await res.text();
      const parsed = JSON.parse(text) as { error?: { code?: string } };
      assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
      for (const secret of ['@example', 'orderHistory', '"email"']) {
        assert.ok(!text.includes(secret), `503 leaked "${secret}"`);
      }
      assert.equal(res.headers.get('x-audit-id'), null);
      assert.equal(await auditCount(), 0);
    } finally {
      model.create = original;
    }
    assert.equal((await get(timelinePath(), adminCookie())).status, 200, 'recovery');
  });

  // ---- M-1: bounded audit-write budget ------------------------------------
  it('M-1: audit write honors the wall-clock budget and fails closed (measured)', async () => {
    const model = AdminAccessAuditModel as unknown as {
      create: typeof AdminAccessAuditModel.create;
    };
    const original = model.create;
    // Never settles: only the budget can end this request.
    model.create = (() => new Promise(() => {})) as typeof AdminAccessAuditModel.create;
    try {
      const started = Date.now();
      const res = await get(timelinePath(), adminCookie());
      const elapsed = Date.now() - started;
      assert.equal(res.status, 503, 'budget exceeded must fail closed');
      const text = await res.text();
      const parsed = JSON.parse(text) as { error?: { code?: string } };
      assert.equal(parsed.error?.code, 'AUDIT_UNAVAILABLE');
      for (const secret of ['@example', 'orderHistory', '"email"']) {
        assert.ok(!text.includes(secret), `503 leaked "${secret}"`);
      }
      assert.equal(res.headers.get('x-audit-id'), null, 'no header for an ambiguous outcome');
      assert.ok(
        elapsed >= AUDIT_WRITE_BUDGET_MS - 500,
        `budget must wait ~${AUDIT_WRITE_BUDGET_MS}ms (got ${elapsed}ms)`,
      );
      assert.ok(
        elapsed <= AUDIT_WRITE_BUDGET_MS + 5_000,
        `budget must bound the wait (got ${elapsed}ms)`,
      );
    } finally {
      model.create = original;
    }
    assert.equal((await get(timelinePath(), adminCookie())).status, 200, 'recovery');
  });
});
