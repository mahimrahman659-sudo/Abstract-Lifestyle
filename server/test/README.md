# Server tests (Phase 0)

`node:test` + `tsx` (already a dev dependency — nothing new to install).

## Run

```bash
# Unit tests only (no database needed)
npm run test:unit

# Integration + concurrency tests (requires a DISPOSABLE replica set)
MONGODB_TEST_MODE=disposable MONGODB_TEST_URI="mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true" npm run test:db

# Everything
# Set both test variables above first.
npm test
```

PowerShell:

```powershell
$env:MONGODB_TEST_MODE = 'disposable'
$env:MONGODB_TEST_URI = 'mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true'
npm run test:db
```

Without intentional `MONGODB_TEST_MODE=disposable` and `MONGODB_TEST_URI`, the
integration suite **fails before connecting or deleting anything**. `test:unit`
needs no database and includes the negative safety and connection-failure tests.

## Requirements

- MongoDB **replica set** (transactions are mandatory). The suite asserts the
  capability in `before()` and fails with the detected topology otherwise.
- A database that may be **wiped**: `beforeEach` deletes every document in every
  collection it touches.
- The database name must end in `_test`; production/staging/live names, system
  databases and all remote hosts are refused, regardless of other flags.
- The helper checks both the designated URI and the actual driver-resolved
  database/host, binds resets to the approved Db object, and rechecks immediately
  before every deletion. `MONGODB_URI` is never a fallback. No URI or credentials
  are logged. Negative tests use in-memory doubles, never a real unsafe target.
- Use a separate disposable port/database; dbpaths belong outside the repository:

```bash
mongod --replSet rs0 --port 27018 --dbpath /temporary/path/p0-rs
mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"
```

## What is covered

| Area | File |
|---|---|
| A1 — deployment capability classification (pure) | `mongo-capabilities.test.ts` |
| A1 — startup guard: standalone rejected, replica set accepted | `topology-guard.test.ts` |
| R2 — configuration/target refusal, zero deletions, no credential disclosure | `test-database-guard.test.ts` |
| R3 — connection/inspection failure cleanup and health readiness | `db-connect.test.ts` |
| A1/B1 — cart version compare-and-swap filter (pure) | `checkout-version-filter.test.ts` |
| A5 — variant archive/delete, stock restore, cancellation abort, races | `order-integrity.test.ts` |
| B1 — cart mutations vs. checkout claim, concurrent add, replay, rollback/recovery | `order-integrity.test.ts` |
| B2 — first-cart upsert race, per-user isolation, duplicate-key policy | `order-integrity.test.ts` |
| B3 — archived/unpublished/out-of-stock/priceless/invalid-quantity lines, valid COD order | `order-integrity.test.ts` |
| R1/R4 — restore identity/history/races/auth, both cancellation paths, HTTP checkout 409s | `order-integrity.test.ts` |
| Phase 2 — manual order/proof/admin review, refund evidence, prepaid fulfilment gates, outbox concurrency | `manual-payments.test.ts` |
| Phase 2 — payment index startup/runtime/reconnection readiness and COD-only behavior | `payment-index-readiness.test.ts` |
| Phase 2 — payment validation, index metadata rules, provider config | `payment-unit.test.ts` |
| Payment index startup failure/auto-index policy | `db-connect.test.ts` |

`MONGODB_STANDALONE_URI` is optional; when set, the A1 guard test proves that a plain `mongod`
(no `--replSet`) is refused at startup. Start one alongside the replica set:

```bash
mongod --port 27019 --dbpath /temporary/path/p0-sa
```

Set `MONGODB_STANDALONE_URI=mongodb://127.0.0.1:27019/p0_standalone_test`.
This optional read-only topology check also requires the safe local `_test`
target and disposable mode. Stop the local processes and remove their temporary
dbpaths after verification.

Client-side A4 tests run with the built-in Node test runner (no dependencies):
`cd client && npm test`.
