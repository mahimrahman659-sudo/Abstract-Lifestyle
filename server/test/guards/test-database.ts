/**
 * Fail-closed guard for the *destructive* integration-test harness.
 *
 * The suite deletes every document in every collection of the database it is
 * pointed at. A mis-set `MONGODB_TEST_URI` (a copy/pasted Atlas URI, a CI secret
 * aimed at staging) must therefore fail **before** any delete rather than wipe
 * real data.
 *
 * Rules (all must hold):
 * 1. an explicit test URI must be configured — the application URI is never used;
 * 2. the *resolved* database name (reported by the driver, not parsed from the
 *    URI string) must end with `_test`;
 * 3. the resolved name must not look production-like (`prod`, `staging`, `live`)
 *    and must not be a known system/application database;
 * 4. only loopback deployments are permitted; remote opt-ins cannot bypass this;
 * 5. MONGODB_TEST_MODE must explicitly be `disposable`.
 *
 * Nothing here ever logs a URI or credentials — only the database name.
 */

export const TEST_DATABASE_SUFFIX = '_test';

/** Exact database names that must never be wiped. */
const FORBIDDEN_EXACT = new Set([
  'abstract_lifestyle',
  'admin',
  'config',
  'local',
  'test',
]);

/** Substrings that mark a production/staging database. */
const FORBIDDEN_SUBSTRINGS = ['prod', 'staging', 'stage', 'live'];

export interface TestTargetInput {
  /** Database name as resolved by the driver (`db.databaseName`). */
  databaseName: string;
  /** Host reported by the driver, e.g. `127.0.0.1` or `acme.abc.mongodb.net`. */
  host: string;
}

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTestDatabaseError';
  }
}

const isLoopbackHost = (host: string): boolean => {
  const normalised = host.trim().toLowerCase();
  return (
    normalised === 'localhost' ||
    normalised === '127.0.0.1' ||
    normalised === '::1' ||
    normalised === '[::1]'
  );
};

/**
 * Pure validation — used before connecting (best effort) and again with the
 * resolved target after connecting (authoritative).
 */
export const assertSafeTestTarget = (input: TestTargetInput): void => {
  const name = input.databaseName.trim();
  const host = input.host.trim();

  if (name.length === 0) {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: the test database name is empty. No records were deleted.',
    );
  }
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run: the test database must be named "*${TEST_DATABASE_SUFFIX}" (resolved "${name}"). No records were deleted.`,
    );
  }

  const lower = name.toLowerCase();
  if (FORBIDDEN_EXACT.has(lower)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run against the "${name}" database: it is a reserved/application database. No records were deleted.`,
    );
  }
  const forbidden = FORBIDDEN_SUBSTRINGS.find((part) => lower.includes(part));
  if (forbidden) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run against "${name}": it looks like a production/staging database ("${forbidden}"). No records were deleted.`,
    );
  }
  if (!isLoopbackHost(host)) {
    throw new UnsafeTestDatabaseError(
      'Refusing to run against a remote host: only disposable loopback deployments are permitted. No records were deleted.',
    );
  }
};

/**
 * Best-effort pre-connection check derived from the URI string. The authoritative
 * check always runs again against the driver-reported database name.
 */
export const assertSafeTestUri = (uri: string): TestTargetInput => {
  if (uri.trim().length === 0) {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: MONGODB_TEST_URI is not set, so no test database is designated. No records were deleted.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: MONGODB_TEST_URI is not a valid URI. No records were deleted.',
    );
  }
  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: MONGODB_TEST_URI must use the mongodb:// or mongodb+srv:// scheme. No records were deleted.',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new UnsafeTestDatabaseError('Refusing invalid test database encoding. No records were deleted.');
  }
  const host = parsed.hostname;
  assertSafeTestTarget({ databaseName, host });
  return { databaseName, host };
};

export const requireTestDatabaseConfig = (
  configuration: NodeJS.ProcessEnv = process.env,
): { uri: string; target: TestTargetInput } => {
  if (configuration.MONGODB_TEST_MODE !== 'disposable') {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: set MONGODB_TEST_MODE=disposable intentionally. No records were deleted.',
    );
  }
  const uri = (configuration.MONGODB_TEST_URI ?? '').trim();
  return { uri, target: assertSafeTestUri(uri) };
};
