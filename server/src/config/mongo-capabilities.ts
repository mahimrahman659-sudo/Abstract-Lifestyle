import type { Connection } from 'mongoose';

/**
 * What the connected MongoDB deployment can actually do.
 *
 * Order creation and cancellation rely on multi-document transactions, which
 * require a replica set or a sharded cluster — a standalone `mongod` silently
 * accepts the connection but fails every transaction at runtime. The API
 * refuses to start in that case instead of returning 500s to shoppers.
 */
export interface DeploymentCapabilities {
  /** True only when multi-document transactions are supported. */
  transactions: boolean;
  kind: 'replica-set' | 'sharded' | 'standalone' | 'unknown';
  /** Human-readable detail for diagnostics (never contains credentials). */
  detail: string;
}

/** Minimal shape of the `hello` command response we rely on. */
export interface HelloResult {
  setName?: unknown;
  msg?: unknown;
  logicalSessionTimeoutMinutes?: unknown;
  isWritablePrimary?: unknown;
}

/**
 * Pure classification of a `hello` payload. Kept separate from the driver call
 * so it can be unit-tested without a database.
 */
export const classifyDeployment = (hello: HelloResult): DeploymentCapabilities => {
  const isSharded = hello.msg === 'isdbgrid';
  const isReplicaSet = typeof hello.setName === 'string' && hello.setName.length > 0;
  const supportsSessions = typeof hello.logicalSessionTimeoutMinutes === 'number';

  if (isSharded) {
    return {
      transactions: true,
      kind: 'sharded',
      detail: 'sharded cluster (mongos) supports multi-document transactions',
    };
  }

  if (isReplicaSet) {
    return {
      transactions: supportsSessions,
      kind: 'replica-set',
      detail: supportsSessions
        ? `replica set "${hello.setName}" with session support`
        : `replica set "${hello.setName}" without logical session support (transactions unavailable)`,
    };
  }

  return {
    transactions: false,
    kind: supportsSessions ? 'unknown' : 'standalone',
    detail:
      'standalone/unknown deployment without a replica set — multi-document transactions are not supported',
  };
};

/** Read-only topology inspection (`hello`). Never writes and never logs the URI. */
export const readDeploymentCapabilities = async (db: NonNullable<Connection['db']>): Promise<DeploymentCapabilities> => {
  const hello = (await db.admin().command({ hello: 1 })) as HelloResult;
  return classifyDeployment(hello);
};

/**
 * Diagnostic shown when the deployment cannot support order transactions.
 * Includes the executable local fix so the failure is self-service.
 */
export const transactionRequirementMessage = (capabilities: DeploymentCapabilities): string =>
  [
    'This MongoDB deployment cannot run order transactions, which checkout and cancellation require.',
    `Detected: ${capabilities.detail}.`,
    'Run a replica set instead of a standalone mongod. Local single-node example:',
    '  mongod --replSet rs0 --dbpath /path/to/data --port 27017',
    '  mongosh --eval "rs.initiate({_id: \\"rs0\\", members: [{_id: 0, host: \\"127.0.0.1:27017\\"}]})"',
    'Then set MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0 and restart.',
    'Managed MongoDB (Atlas) already runs a replica set — check Network Access/credentials if this appears there.',
  ].join('\n');
