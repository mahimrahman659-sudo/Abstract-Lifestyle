import './setup-env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import {
  ACTIVITY_INDEX_SPECS,
  activityIndexRequirementMessage,
  evaluateActivityIndexes,
  getActivityIndexReadiness,
  type IndexInfo,
} from '../src/config/activity-index.js';
import { ACTIVITY_EVENT_TTL_SECONDS } from '../src/models/activity-event.model.js';
import { deterministicEventId } from '../src/utils/event-id.js';

/** Builds a realistic index listing matching every designed spec. */
const correctIndexes = (): IndexInfo[] =>
  ACTIVITY_INDEX_SPECS.map((spec) => ({
    name: spec.name,
    key: Object.fromEntries(spec.key),
    ...(spec.unique ? { unique: true } : {}),
    ...(spec.sparse ? { sparse: true } : {}),
    ...(spec.expireAfterSeconds !== null
      ? { expireAfterSeconds: spec.expireAfterSeconds }
      : {}),
  }));

const mutate = (fn: (indexes: IndexInfo[]) => void): IndexInfo[] => {
  const indexes = correctIndexes();
  fn(indexes);
  return indexes;
};

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

describe('Phase 1B-A — activity index readiness (unit)', () => {
  it('accepts the exact designed index set, including TTL and sparse flags', () => {
    const readiness = evaluateActivityIndexes(correctIndexes(), true);
    assert.equal(readiness.ready, true, readiness.reason);
    assert.equal(readiness.required, true);
  });

  it('is not required while activity events are disabled', () => {
    const readiness = evaluateActivityIndexes([], false);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.required, false);
  });

  it('reports each missing index by name', () => {
    for (const spec of ACTIVITY_INDEX_SPECS) {
      const indexes = correctIndexes().filter((item) => item.name !== spec.name);
      const readiness = evaluateActivityIndexes(indexes, true);
      assert.equal(readiness.ready, false, `${spec.name} must be required`);
      assert.ok(readiness.reason.includes(spec.name), readiness.reason);
      assert.ok(readiness.reason.includes('missing'), readiness.reason);
    }
  });

  it('rejects WRONG KEY ORDER (names alone must never pass)', () => {
    const indexes = mutate((list) => {
      const type = list.find((item) => item.name === 'activity_type_ts');
      assert.ok(type);
      // Same fields, reversed order — must fail.
      type.key = { ts: -1, type: 1 };
    });
    const readiness = evaluateActivityIndexes(indexes, true);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reason.includes('key order'), readiness.reason);
  });

  it('rejects a wrong key pattern on the unique index', () => {
    const indexes = mutate((list) => {
      const unique = list.find((item) => item.name === 'activity_eventId_unique');
      assert.ok(unique);
      unique.key = { uuid: 1 };
    });
    const readiness = evaluateActivityIndexes(indexes, true);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reason.includes('activity_eventId_unique'), readiness.reason);
  });

  it('rejects a NON-unique eventId index (idempotency must not silently degrade)', () => {
    const indexes = mutate((list) => {
      const unique = list.find((item) => item.name === 'activity_eventId_unique');
      assert.ok(unique);
      delete unique.unique;
    });
    const readiness = evaluateActivityIndexes(indexes, true);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reason.includes('not unique'), readiness.reason);
  });

  it('rejects an incorrect TTL on the retention index', () => {
    for (const wrongTtl of [0, 60, 86_400, ACTIVITY_EVENT_TTL_SECONDS + 1]) {
      const indexes = mutate((list) => {
        const ttl = list.find((item) => item.name === 'activity_ts_ttl');
        assert.ok(ttl);
        ttl.expireAfterSeconds = wrongTtl;
      });
      const readiness = evaluateActivityIndexes(indexes, true);
      assert.equal(readiness.ready, false, `TTL ${wrongTtl} must be rejected`);
      assert.ok(readiness.reason.includes('expiry'), readiness.reason);
    }
  });

  it('rejects a MISSING TTL and an unexpected TTL on a non-TTL index', () => {
    const noTtl = mutate((list) => {
      const ttl = list.find((item) => item.name === 'activity_ts_ttl');
      assert.ok(ttl);
      delete ttl.expireAfterSeconds;
    });
    const missing = evaluateActivityIndexes(noTtl, true);
    assert.equal(missing.ready, false);
    assert.ok(missing.reason.includes('expiry'), missing.reason);

    const extraTtl = mutate((list) => {
      const type = list.find((item) => item.name === 'activity_type_ts');
      assert.ok(type);
      type.expireAfterSeconds = 60;
    });
    const unexpected = evaluateActivityIndexes(extraTtl, true);
    assert.equal(unexpected.ready, false);
    assert.ok(unexpected.reason.includes('expiry'), unexpected.reason);
  });

  it('rejects sparse mismatches on the timeline index', () => {
    const notSparse = mutate((list) => {
      const user = list.find((item) => item.name === 'activity_userId_ts');
      assert.ok(user);
      delete user.sparse;
    });
    const readiness = evaluateActivityIndexes(notSparse, true);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reason.includes('sparse'), readiness.reason);

    const wronglySparse = mutate((list) => {
      const unique = list.find((item) => item.name === 'activity_eventId_unique');
      assert.ok(unique);
      unique.sparse = true;
    });
    const second = evaluateActivityIndexes(wronglySparse, true);
    assert.equal(second.ready, false);
    assert.ok(second.reason.includes('sparse'), second.reason);
  });

  it('rejects hidden or collation-bearing indexes', () => {
    const hidden = mutate((list) => {
      const ttl = list.find((item) => item.name === 'activity_ts_ttl');
      assert.ok(ttl);
      ttl.hidden = true;
    });
    const hiddenResult = evaluateActivityIndexes(hidden, true);
    assert.equal(hiddenResult.ready, false);
    assert.ok(hiddenResult.reason.includes('hidden'), hiddenResult.reason);

    const collation = mutate((list) => {
      const ttl = list.find((item) => item.name === 'activity_ts_ttl');
      assert.ok(ttl);
      ttl.collation = { locale: 'en' };
    });
    const collationResult = evaluateActivityIndexes(collation, true);
    assert.equal(collationResult.ready, false);
    assert.ok(collationResult.reason.includes('collation'), collationResult.reason);
  });

  it('treats an empty index list (missing collection) as not ready when required', () => {
    const readiness = evaluateActivityIndexes([], true);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reason.includes('missing'), readiness.reason);
  });

  it('requirement message names the flag and the fix', () => {
    const message = activityIndexRequirementMessage({
      ready: false,
      required: true,
      reason: 'the required index "activity_eventId_unique" is missing',
    });
    assert.ok(message.includes('ACTIVITY_EVENTS_ENABLED=true'));
    assert.ok(message.includes('activity_eventId_unique'));
    assert.ok(message.includes('ACTIVITY_EVENTS_ENABLED=false'));
  });

  it('reports not-required while the flag is off, and fails closed while on without a connection', async () => {
    setFlag(false);
    try {
      const readiness = await getActivityIndexReadiness();
      assert.equal(readiness.ready, true, 'flag off ⇒ nothing required');
      assert.equal(readiness.required, false);
    } finally {
      setFlag(false);
    }
    // Flag on with NO connection ⇒ fail closed with a clear reason.
    setFlag(true);
    try {
      const readiness = await getActivityIndexReadiness();
      assert.equal(readiness.ready, false);
      assert.equal(readiness.required, true);
      assert.ok(
        readiness.reason.includes('not connected') ||
          readiness.reason.includes('could not be inspected') ||
          readiness.reason.includes('database'),
        readiness.reason,
      );
    } finally {
      setFlag(false);
    }
  });
});

describe('Phase 1B-B — deterministic event ids (unit)', () => {
  it('matches the RFC 4122 UUIDv5 known vector (DNS namespace + www.example.com)', () => {
    assert.equal(
      deterministicEventId('www.example.com'),
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('is stable, v4-shaped-outside-version-nibble, and collision-free per name', () => {
    const first = deterministicEventId('order.purchased:656f0c9e8a8f8e0000000001');
    const again = deterministicEventId('order.purchased:656f0c9e8a8f8e0000000001');
    const other = deterministicEventId('order.purchased:656f0c9e8a8f8e0000000002');
    assert.equal(first, again, 'same name ⇒ same id (retry dedup)');
    assert.notEqual(first, other, 'different facts ⇒ different ids');
    // v5: version nibble 5, RFC variant 8-b.
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // The widened model pattern must accept it.
    assert.match(
      first,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[345][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
