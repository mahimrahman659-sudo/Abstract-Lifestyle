import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDeployment,
  transactionRequirementMessage,
  type HelloResult,
} from '../src/config/mongo-capabilities.js';

describe('A1 — deployment capability classification', () => {
  it('accepts a replica set with logical sessions', () => {
    const hello: HelloResult = { setName: 'atlas-abc', logicalSessionTimeoutMinutes: 30 };
    const caps = classifyDeployment(hello);
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'replica-set');
    assert.match(caps.detail, /replica set "atlas-abc"/);
  });

  it('rejects a replica set without logical sessions', () => {
    const caps = classifyDeployment({ setName: 'rs0' });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'replica-set');
  });

  it('accepts a sharded cluster (mongos)', () => {
    const caps = classifyDeployment({ msg: 'isdbgrid', logicalSessionTimeoutMinutes: 30 });
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'sharded');
  });

  it('rejects a standalone server', () => {
    const caps = classifyDeployment({ isWritablePrimary: true });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'standalone');
  });

  it('treats a session-capable but unnamed topology as unknown, not transactional', () => {
    const caps = classifyDeployment({ logicalSessionTimeoutMinutes: 30 });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'unknown');
  });

  it('explains how to run a local replica set', () => {
    const message = transactionRequirementMessage(classifyDeployment({}));
    assert.match(message, /--replSet rs0/);
    assert.match(message, /rs\.initiate/);
    assert.match(message, /MONGODB_URI/);
  });
});
