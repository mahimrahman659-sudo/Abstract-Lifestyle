/**
 * Test environment bootstrap. MUST be the first import in every server test file:
 * `src/config/env.ts` validates `process.env` at import time.
 *
 * Integration tests fail closed unless both disposable mode and a safe local
 * test URI are configured. See `server/test/README.md`.
 */
const testUri = (process.env.MONGODB_TEST_URI ?? '').trim();

process.env.NODE_ENV = 'test';
// env.ts requires a URI/JWT/admin credentials even for tests; the placeholder is
// only satisfies env validation; no integration helper uses this as a fallback.
process.env.MONGODB_URI =
  testUri.length > 0 ? testUri : 'mongodb://127.0.0.1:27017/abstract_lifestyle_p0_unavailable';
process.env.JWT_SECRET = 'test-jwt-secret-p0-'.padEnd(48, 'x');
process.env.CLIENT_ORIGIN = 'http://localhost:3000';
process.env.SHIPPING_FEE = '0';
process.env.ADMIN_EMAIL = 'p0-admin@example.com';
process.env.ADMIN_PASSWORD = 'p0-test-admin-password';
