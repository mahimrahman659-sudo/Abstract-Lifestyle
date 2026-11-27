import './setup-env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import express from 'express';
import { once } from 'node:events';
import { connectDB, disconnectDB, getDeploymentCapabilities } from '../src/config/db.js';
import type { DeploymentCapabilities } from '../src/config/mongo-capabilities.js';
import type { PaymentIndexReadiness } from '../src/config/payment-index.js';
import { env } from '../src/config/env.js';
import { getHealth } from '../src/controllers/health.controller.js';
import { mockConnection } from './helpers/mock-connection.js';

const uri = 'mongodb://127.0.0.1:1/unavailable_test'; // never opened by these unit tests
const db = { admin: () => ({ command: async () => ({ setName: 'rs0', logicalSessionTimeoutMinutes: 30, ok: 1 }) }) };

const noTransactions: DeploymentCapabilities = {
  transactions: false,
  kind: 'standalone',
  detail: 'standalone deployment',
};

const replicaSet: DeploymentCapabilities = {
  transactions: true,
  kind: 'replica-set',
  detail: 'test replica set',
};

const setManualProviders = (enabled: boolean): void => {
  env.BKASH_PAYMENT_ENABLED = enabled;
  env.BKASH_PAYMENT_NUMBER = enabled ? '01711111111' : '';
  env.NAGAD_PAYMENT_ENABLED = false;
  env.NAGAD_PAYMENT_NUMBER = '';
  env.ROCKET_PAYMENT_ENABLED = false;
  env.ROCKET_PAYMENT_NUMBER = '';
};

const ready: PaymentIndexReadiness = {
  ready: true,
  required: true,
  reason: 'test index ready',
};
const missing: PaymentIndexReadiness = {
  ready: false,
  required: true,
  reason: 'test index missing',
};

describe('R3/P2 — MongoDB capability inspection failure handling', () => {
  it('closes the connection and clears previous capabilities when inspection throws', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    assert.equal(getDeploymentCapabilities()?.transactions, true);
    const throwingInspector = async (): Promise<DeploymentCapabilities> => {
      throw new Error('hello command not allowed');
    };

    await assert.rejects(
      connectDB({
        uri,
        inspectCapabilities: throwingInspector,
      }),
      /transaction capability could not be verified/,
    );

    assert.equal(mongoose.connection.readyState, 0, 'connection closed after inspection failure');
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('does not start when the deployment lacks transactions', async (t) => {
    mockConnection(t, db);
    const noTxInspector = async (): Promise<DeploymentCapabilities> => noTransactions;

    await assert.rejects(
      connectDB({
        uri,
        inspectCapabilities: noTxInspector,
      }),
      /cannot run order transactions/,
    );

    assert.equal(
      mongoose.connection.readyState,
      0,
      'connection closed for non-transactional deployment',
    );
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('connects successfully when inspection succeeds on a replica set', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });

    const caps = getDeploymentCapabilities();
    assert.ok(caps);
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'replica-set');

    await disconnectDB();
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('cleans up and clears previous capabilities when connecting fails', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    const failure = new Error('injected connection failure');
    t.mock.method(mongoose, 'connect', async () => { throw failure; });
    await assert.rejects(connectDB({ uri }), (error: unknown) => error === failure);
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('clears capabilities even if disconnect itself fails', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    t.mock.method(mongoose, 'disconnect', async () => { throw new Error('disconnect failure'); });
    await assert.rejects(disconnectDB(), /disconnect failure/);
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('never returns stale support after connection loss or replacement', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true, writable: true });
    assert.equal(getDeploymentCapabilities(), null);
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true, writable: true });
    Object.defineProperty(mongoose.connection, 'db', { value: { ...db }, configurable: true, writable: true });
    assert.equal(getDeploymentCapabilities(), null);
    await disconnectDB();
  });

  it('returns HTTP 503 without stale transaction support after inspection fails', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    await assert.rejects(connectDB({ uri, inspectCapabilities: async () => { throw new Error('hello failure'); } }));
    const app = express();
    app.get('/health', getHealth);
    const server = app.listen(0, '127.0.0.1');
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, transactions: false });
  });

  describe('payment index readiness at startup', () => {
    it('fails startup when a manual provider is enabled and the index is missing', async (t) => {
      mockConnection(t, db);
      t.after(() => setManualProviders(false));
      setManualProviders(true);

      await assert.rejects(
        connectDB({
          uri,
          inspectCapabilities: async () => replicaSet,
          inspectPaymentIndex: async () => missing,
        }),
        /required MongoDB payment index is not ready/,
      );
      assert.equal(mongoose.connection.readyState, 0);
      assert.equal(getDeploymentCapabilities(), null);
    });

    it('fails startup when the index inspection throws', async (t) => {
      mockConnection(t, db);
      t.after(() => setManualProviders(false));
      setManualProviders(true);

      await assert.rejects(
        connectDB({
          uri,
          inspectCapabilities: async () => replicaSet,
          inspectPaymentIndex: async () => {
            throw new Error('index metadata failure');
          },
        }),
        /required MongoDB payment index is not ready/,
      );
      assert.equal(mongoose.connection.readyState, 0);
      assert.equal(getDeploymentCapabilities(), null);
    });

    it('accepts a correctly configured index with a manual provider enabled', async (t) => {
      const connect = mockConnection(t, db);
      t.after(() => setManualProviders(false));
      setManualProviders(true);

      await connectDB({
        uri,
        inspectCapabilities: async () => replicaSet,
        inspectPaymentIndex: async () => ready,
      });
      assert.equal(getDeploymentCapabilities()?.transactions, true);
      assert.deepEqual(
        (connect.mock.calls[0]?.arguments as unknown[])?.[1],
        { autoIndex: false },
        'manual payments disable implicit production index creation',
      );
      await disconnectDB();
    });

    it('does not require the payment index when every manual provider is disabled', async (t) => {
      mockConnection(t, db);
      t.after(() => setManualProviders(false));
      setManualProviders(false);
      let inspected = false;

      await connectDB({
        uri,
        inspectCapabilities: async () => replicaSet,
        inspectPaymentIndex: async () => {
          inspected = true;
          return missing;
        },
      });
      assert.equal(inspected, false, 'the payment index is not consulted for COD-only startup');
      assert.equal(getDeploymentCapabilities()?.transactions, true);
      await disconnectDB();
    });
  });
});
