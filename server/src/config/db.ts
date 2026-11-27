import mongoose from 'mongoose';
import { env } from './env.js';
import {
  inspectPaymentTrxIdIndex,
  paymentIndexRequirementMessage,
  type PaymentIndexReadiness,
} from './payment-index.js';
import { isAnyManualProviderEnabled } from './payment.js';
import {
  readDeploymentCapabilities,
  transactionRequirementMessage,
  type DeploymentCapabilities,
} from './mongo-capabilities.js';

/** Capabilities of the current connection (null before connect / after disconnect). */
let capabilities: DeploymentCapabilities | null = null;
let capabilityDatabase: DatabaseHandle | null = null;

export interface ConnectOptions {
  /**
   * Fail the connection when the deployment cannot run multi-document
   * transactions. The API requires them (checkout, cancellation); one-off
   * maintenance scripts that only touch single documents may opt out.
   */
  requireTransactions?: boolean;
  /** Override the configured URI (tests exercise specific topologies). */
  uri?: string;
  /** Test seam: substitute the capability inspector (failure-injection tests). */
  inspectCapabilities?: (db: DatabaseHandle) => Promise<DeploymentCapabilities>;
  /** Test seam: substitute the payment-index inspector (failure-injection tests). */
  inspectPaymentIndex?: (db: DatabaseHandle) => Promise<PaymentIndexReadiness>;
}

type DatabaseHandle = NonNullable<typeof mongoose.connection.db>;

export const connectDB = async ({
  requireTransactions = true,
  uri = env.MONGODB_URI,
  inspectCapabilities = readDeploymentCapabilities,
  inspectPaymentIndex = inspectPaymentTrxIdIndex,
}: ConnectOptions = {}): Promise<void> => {
  // Never let a previous connection's facts leak into this one.
  capabilities = null;
  capabilityDatabase = null;
  const manualPaymentsRequired = isAnyManualProviderEnabled();

  try {
    // Never silently create production indexes. When a manual provider is
    // enabled, also disable implicit index creation so startup can fail closed
    // unless the explicit payment index already exists.
    await mongoose.connect(uri, {
      autoIndex: env.NODE_ENV === 'development' && !manualPaymentsRequired,
    });
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    throw error;
  }

  const db = mongoose.connection.db;
  if (!db) {
    await mongoose.disconnect().catch(() => undefined);
    throw new Error('MongoDB connected but no database handle is available.');
  }

  let deployment: DeploymentCapabilities;
  try {
    deployment = await inspectCapabilities(db);
  } catch (error) {
    // Inspection failed: close the connection and fail loudly. Reporting stale
    // transaction support would let the API start and then 500 on every checkout.
    await mongoose.disconnect().catch(() => undefined);
    capabilities = null;
    throw new Error(
      'MongoDB connected but its transaction capability could not be verified, so the API will not start. ' +
        'Check MONGODB_URI and that the deployment allows the `hello` command.',
      { cause: error },
    );
  }

  if (requireTransactions && !deployment.transactions) {
    // Never run the API in a mode where every checkout would fail at runtime.
    await mongoose.disconnect().catch(() => undefined);
    capabilities = null;
    throw new Error(transactionRequirementMessage(deployment));
  }

  if (manualPaymentsRequired) {
    let readiness: PaymentIndexReadiness;
    try {
      readiness = await inspectPaymentIndex(db);
    } catch {
      readiness = {
        ready: false,
        required: true,
        reason: 'the index metadata inspection threw an error',
      };
    }
    if (!readiness.ready) {
      await mongoose.disconnect().catch(() => undefined);
      capabilities = null;
      throw new Error(paymentIndexRequirementMessage(readiness));
    }
  }

  capabilities = deployment;
  capabilityDatabase = db;
  const { name } = mongoose.connection;
  console.log(`MongoDB connected${name ? ` (db: ${name})` : ''} — ${deployment.detail}`);
};

/** Topology facts of the active connection (used by the readiness endpoint). */
export const getDeploymentCapabilities = (): DeploymentCapabilities | null =>
  mongoose.connection.readyState === 1 && mongoose.connection.db === capabilityDatabase
    ? capabilities
    : null;

export const disconnectDB = async (): Promise<void> => {
  capabilities = null;
  capabilityDatabase = null;
  await mongoose.disconnect();
};
