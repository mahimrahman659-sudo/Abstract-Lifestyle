import './setup-env.js';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDB, disconnectDB, getDeploymentCapabilities } from '../src/config/db.js';
import { OrderModel } from '../src/models/order.model.js';
import { assertSafeTestUri, requireTestDatabaseConfig } from './guards/test-database.js';

const replicaSetUri = (process.env.MONGODB_TEST_URI ?? '').trim();
const standaloneUri = (process.env.MONGODB_STANDALONE_URI ?? '').trim();

const skipStandalone: string | false =
  standaloneUri.length > 0
    ? false
    : 'MONGODB_STANDALONE_URI is not set — start a plain mongod (no --replSet) to exercise the guard';

describe('A1 — startup refuses a deployment without transactions', { skip: skipStandalone }, () => {
  after(async () => {
    await disconnectDB().catch(() => undefined);
  });

  it('fails with an actionable diagnostic and leaves no usable connection', async () => {
    requireTestDatabaseConfig();
    assertSafeTestUri(standaloneUri);
    await assert.rejects(connectDB({ uri: standaloneUri }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /cannot run order transactions/);
      assert.match(error.message, /--replSet rs0/);
      assert.match(error.message, /rs\.initiate/);
      return true;
    });

    assert.equal(mongoose.connection.readyState, 0, 'connection is closed after the refusal');
    assert.equal(getDeploymentCapabilities(), null, 'no capability is published');

    // No order writes are possible: the driver cannot reach a database.
    await assert.rejects(OrderModel.countDocuments().exec());
  });
});

describe('A1 — startup accepts a replica set', () => {
  after(async () => {
    await disconnectDB().catch(() => undefined);
  });

  it('connects, reports transaction support and answers a ping', async () => {
    requireTestDatabaseConfig();
    assertSafeTestUri(replicaSetUri);
    await connectDB({ uri: replicaSetUri });

    const capabilities = getDeploymentCapabilities();
    assert.ok(capabilities);
    assert.equal(capabilities.transactions, true);
    assert.ok(
      capabilities.kind === 'replica-set' || capabilities.kind === 'sharded',
      `unexpected topology: ${capabilities.detail}`,
    );

    const ping = await mongoose.connection.db?.admin().command({ ping: 1 });
    assert.equal(ping?.ok, 1);
  });
});
