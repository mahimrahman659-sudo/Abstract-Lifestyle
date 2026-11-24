import './setup-env.js';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { ActivityEventModel } from '../src/models/activity-event.model.js';
import { activityIndexRequirementMessage } from '../src/config/activity-index.js';

/**
 * R-1 startup gate: with ACTIVITY_EVENTS_ENABLED=true the API must refuse to
 * connect/start when required activity indexes are missing or mismatched —
 * therefore ingestion requests can never be accepted without them.
 * With the flag false the gate is skipped entirely (disabled deployments are
 * unaffected). Indexes are inspected, never created.
 */

const setFlag = (enabled: boolean): void => {
  (env as unknown as Record<string, unknown>).ACTIVITY_EVENTS_ENABLED = enabled;
};

const connectOptions = () => ({
  uri: process.env.MONGODB_TEST_URI as string,
  requireTransactions: true,
});

after(async () => {
  setFlag(false);
  await disconnectDB().catch(() => undefined);
});

describe('Phase 1B-A — connectDB activity-index startup gate (disposable database)', () => {
  it('REFUSES to start when the flag is on and a readiness injection fails', async () => {
    setFlag(true);
    let inspected = 0;
    await assert.rejects(
      connectDB({
        ...connectOptions(),
        inspectActivityIndex: async () => {
          inspected += 1;
          return {
            ready: false,
            required: true,
            reason: 'the required index "activity_eventId_unique" is missing',
          };
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('ACTIVITY_EVENTS_ENABLED=true'));
        assert.ok(error.message.includes('activity_eventId_unique'));
        return true;
      },
    );
    assert.equal(inspected, 1, 'readiness was verified before startup failed');
    assert.equal(
      mongoose.connection.readyState,
      0,
      'failed gate must leave the API disconnected (never listening)',
    );
  });

  it('CONNECTS when the flag is on and readiness passes', async () => {
    setFlag(true);
    let inspected = 0;
    await connectDB({
      ...connectOptions(),
      inspectActivityIndex: async () => {
        inspected += 1;
        return { ready: true, required: true, reason: 'ok' };
      },
    });
    assert.equal(inspected, 1);
    assert.equal(mongoose.connection.readyState, 1);
    await disconnectDB();
  });

  it('SKIPS the gate entirely when the flag is off (even with missing indexes)', async () => {
    setFlag(false);
    let inspected = 0;
    await connectDB({
      ...connectOptions(),
      inspectActivityIndex: async () => {
        inspected += 1;
        return { ready: false, required: true, reason: 'should never be consulted' };
      },
    });
    assert.equal(inspected, 0, 'flag off ⇒ zero readiness work, zero gate');
    assert.equal(mongoose.connection.readyState, 1);
    await disconnectDB();
  });

  it('REAL inspection: refuses with a missing collection, accepts after indexes exist', async () => {
    setFlag(true);
    // Drop while CONNECTED — a drop issued on a closed connection fails fast
    // and would be swallowed, leaving the indexes in place.
    await mongoose.connect(process.env.MONGODB_TEST_URI as string, {
      autoIndex: false,
      autoCreate: false,
    });
    await ActivityEventModel.collection.drop().catch(() => undefined);
    await mongoose.disconnect();

    // Missing namespace ⇒ every required index missing ⇒ fail closed.
    await assert.rejects(
      connectDB(connectOptions()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('not ready'), error.message);
        assert.ok(error.message.includes('missing'), error.message);
        return true;
      },
    );
    assert.equal(mongoose.connection.readyState, 0);

    // Create collection + designed indexes (disposable DB only) ⇒ gate passes.
    const dbReady = await (async (): Promise<boolean> => {
      await mongoose.connect(process.env.MONGODB_TEST_URI as string, {
        autoIndex: false,
        autoCreate: false,
      });
      try {
        const db = mongoose.connection.db;
        assert.ok(db);
        const existing = await db
          .listCollections({ name: 'activity_events' })
          .toArray();
        if (existing.length === 0) {
          await db.createCollection('activity_events');
        }
        await ActivityEventModel.syncIndexes();
        return true;
      } finally {
        await mongoose.disconnect();
      }
    })();
    assert.equal(dbReady, true);

    await connectDB(connectOptions());
    assert.equal(mongoose.connection.readyState, 1);
    await disconnectDB();
    setFlag(false);
  });

  it('requirement message helper stays aligned with the gate wording', () => {
    const message = activityIndexRequirementMessage({
      ready: false,
      required: true,
      reason: 'test reason',
    });
    assert.ok(message.includes('test reason'));
    assert.ok(message.includes('never') || message.includes('operational'));
  });
});
