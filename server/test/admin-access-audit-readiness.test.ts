import './setup-env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import {
  ADMIN_ACCESS_AUDIT_INDEX_SPECS,
  AUDIT_INSPECT_BUDGET_MS,
  AUDIT_READINESS_CACHE_TTL_MS,
  evaluateAdminAccessAuditIndexes,
  getAdminAccessAuditReadiness,
  inspectAdminAccessAuditIndexes,
  invalidateAdminAccessAuditReadinessCache,
  type AuditIndexInfo,
} from '../src/config/admin-access-audit-index.js';
import {
  ADMIN_ACCESS_AUDIT_TTL_SECONDS,
} from '../src/models/admin-access-audit.model.js';
import {
  AUDIT_WRITE_BUDGET_MS,
  sanitizeAuditLogMessage,
} from '../src/services/admin-access-audit.service.js';

/**
 * Phase 2B corrections — audit readiness (H-1), time budgets (M-1) and log
 * sanitization (L-1). Pure/unit tests: no database connection required.
 */

const correctIndexes = (): AuditIndexInfo[] =>
  ADMIN_ACCESS_AUDIT_INDEX_SPECS.map((spec) => ({
    name: spec.name,
    key: Object.fromEntries(spec.key),
    ...(spec.unique ? { unique: true } : {}),
    ...(spec.sparse ? { sparse: true } : {}),
    ...(spec.expireAfterSeconds !== null
      ? { expireAfterSeconds: spec.expireAfterSeconds }
      : {}),
  }));

const mutate = (fn: (indexes: AuditIndexInfo[]) => void): AuditIndexInfo[] => {
  const indexes = correctIndexes();
  fn(indexes);
  return indexes;
};

describe('Phase 2B — audit index readiness evaluation (unit)', () => {
  it('accepts the exact four designed index definitions', () => {
    const readiness = evaluateAdminAccessAuditIndexes(correctIndexes());
    assert.equal(readiness.ready, true, readiness.reason);
    assert.equal(ADMIN_ACCESS_AUDIT_INDEX_SPECS.length, 4);
    assert.equal(ADMIN_ACCESS_AUDIT_TTL_SECONDS, 365 * 24 * 60 * 60);
  });

  it('rejects each missing index by name', () => {
    for (const spec of ADMIN_ACCESS_AUDIT_INDEX_SPECS) {
      const indexes = correctIndexes().filter((item) => item.name !== spec.name);
      const readiness = evaluateAdminAccessAuditIndexes(indexes);
      assert.equal(readiness.ready, false, `${spec.name} must be required`);
      assert.ok(readiness.reason.includes(spec.name), readiness.reason);
      assert.ok(readiness.reason.includes('missing'), readiness.reason);
    }
  });

  it('rejects wrong key ORDER (names alone never pass)', () => {
    const indexes = mutate((list) => {
      const target = list.find((item) => item.name === 'audit_admin_at');
      assert.ok(target);
      target.key = { at: -1, adminId: 1 }; // same fields, reversed order
    });
    const readiness = evaluateAdminAccessAuditIndexes(indexes);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reason.includes('key order'), readiness.reason);
  });

  it('rejects incorrect uniqueness and sparsity', () => {
    const notUnique = mutate((list) => {
      const target = list.find((item) => item.name === 'audit_auditId_unique');
      assert.ok(target);
      delete target.unique;
    });
    const uniqueResult = evaluateAdminAccessAuditIndexes(notUnique);
    assert.equal(uniqueResult.ready, false);
    assert.ok(uniqueResult.reason.includes('not unique'), uniqueResult.reason);

    const wronglySparse = mutate((list) => {
      const target = list.find((item) => item.name === 'audit_auditId_unique');
      assert.ok(target);
      target.sparse = true;
    });
    const sparseResult = evaluateAdminAccessAuditIndexes(wronglySparse);
    assert.equal(sparseResult.ready, false);
    assert.ok(sparseResult.reason.includes('sparse'), sparseResult.reason);
  });

  it('rejects incorrect, missing or unexpected TTL values', () => {
    for (const wrongTtl of [0, 60, 86_400, ADMIN_ACCESS_AUDIT_TTL_SECONDS + 1]) {
      const indexes = mutate((list) => {
        const target = list.find((item) => item.name === 'audit_at_ttl');
        assert.ok(target);
        target.expireAfterSeconds = wrongTtl;
      });
      const readiness = evaluateAdminAccessAuditIndexes(indexes);
      assert.equal(readiness.ready, false, `TTL ${wrongTtl} must be rejected`);
      assert.ok(readiness.reason.includes('expiry'), readiness.reason);
    }

    const missingTtl = mutate((list) => {
      const target = list.find((item) => item.name === 'audit_at_ttl');
      assert.ok(target);
      delete target.expireAfterSeconds;
    });
    const missingResult = evaluateAdminAccessAuditIndexes(missingTtl);
    assert.equal(missingResult.ready, false);
    assert.ok(missingResult.reason.includes('expiry'), missingResult.reason);

    const extraTtl = mutate((list) => {
      const target = list.find((item) => item.name === 'audit_admin_at');
      assert.ok(target);
      target.expireAfterSeconds = 60;
    });
    const extraResult = evaluateAdminAccessAuditIndexes(extraTtl);
    assert.equal(extraResult.ready, false);
    assert.ok(extraResult.reason.includes('expiry'), extraResult.reason);
  });

  it('rejects hidden or collation-bearing indexes', () => {
    const hidden = mutate((list) => {
      const target = list.find((item) => item.name === 'audit_at_ttl');
      assert.ok(target);
      target.hidden = true;
    });
    const hiddenResult = evaluateAdminAccessAuditIndexes(hidden);
    assert.equal(hiddenResult.ready, false);
    assert.ok(hiddenResult.reason.includes('hidden'), hiddenResult.reason);

    const collation = mutate((list) => {
      const target = list.find((item) => item.name === 'audit_at_ttl');
      assert.ok(target);
      target.collation = { locale: 'en' };
    });
    const collationResult = evaluateAdminAccessAuditIndexes(collation);
    assert.equal(collationResult.ready, false);
    assert.ok(collationResult.reason.includes('collation'), collationResult.reason);
  });

  it('never treats an inspection error as ready (missing namespace / generic failure)', async () => {
    // Missing collection (NamespaceNotFound) → all specs missing → not ready.
    const missingNs = await inspectAdminAccessAuditIndexes({
      collection: () => ({
        indexes: () => {
          const error = new Error('ns does not exist') as Error & {
            code: number;
            codeName: string;
          };
          error.code = 26;
          error.codeName = 'NamespaceNotFound';
          throw error;
        },
      }),
    } as unknown as NonNullable<typeof mongoose.connection.db>);
    assert.equal(missingNs.ready, false);
    assert.ok(missingNs.reason.includes('missing'), missingNs.reason);

    // Generic inspection failure → not ready (NEVER ready on error).
    const broken = await inspectAdminAccessAuditIndexes({
      collection: () => ({
        indexes: () => Promise.reject(new Error('socket destroyed')),
      }),
    } as unknown as NonNullable<typeof mongoose.connection.db>);
    assert.equal(broken.ready, false);
    assert.ok(broken.reason.includes('could not be inspected'), broken.reason);
  });

  it('fails closed with a clear reason when the database is not connected', async () => {
    // This unit process never connects: readyState is 0.
    invalidateAdminAccessAuditReadinessCache();
    const readiness = await getAdminAccessAuditReadiness();
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reason.includes('not connected'), readiness.reason);
    invalidateAdminAccessAuditReadinessCache();
  });
});

describe('Phase 2B — bounded budgets and log sanitization (unit)', () => {
  it('audit write budget is inside the required 3-5 s window', () => {
    assert.equal(AUDIT_WRITE_BUDGET_MS, 4_000);
    assert.ok(AUDIT_WRITE_BUDGET_MS >= 3_000 && AUDIT_WRITE_BUDGET_MS <= 5_000);
    assert.ok(AUDIT_INSPECT_BUDGET_MS > 0 && AUDIT_INSPECT_BUDGET_MS <= AUDIT_WRITE_BUDGET_MS);
    assert.equal(AUDIT_READINESS_CACHE_TTL_MS, 60_000, 'bounded cache validity');
  });

  it('redacts endpoint-like strings and caps audit failure logs (L-1)', () => {
    const redacted = sanitizeAuditLogMessage(
      'connect ECONNREFUSED 127.0.0.1:27017 while connecting to 127.0.0.1:27017',
    );
    assert.ok(!redacted.includes('127.0.0.1:27017'), 'host:port must be redacted');
    assert.ok(redacted.includes('[endpoint]'));
    assert.equal(sanitizeAuditLogMessage('x'.repeat(400)).length, 300, 'length capped');
    // Ordinary messages pass through unchanged.
    assert.equal(sanitizeAuditLogMessage('simulated audit store outage'), 'simulated audit store outage');
  });
});
