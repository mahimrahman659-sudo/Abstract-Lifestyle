# Phase 0 — Final Corrective Implementation (2026-11-17)

**Verdict: PASS for R1–R5. Owner approval pending.** Branch `fix/audit-p0-order-integrity`, HEAD/baseline `f39ac2a`; nothing committed, pushed, merged or deployed. This section supersedes the historical implementation status and counts below. No Phase 1 work, dependency changes, production writes, production configuration edits or migration.

## Corrected findings

| Finding | Final implementation and evidence |
|---|---|
| R2 — destructive test safety | `MONGODB_TEST_MODE=disposable` plus explicit `MONGODB_TEST_URI` required before connection. `_test` suffix mandatory; production/staging/live/system names and all remote hosts refused regardless of other flags. Driver-resolved name/host validated after connection; automatic collection/index creation disabled until approval of the target. Reset is bound to the approved Db object and revalidates configuration, identity and target before every deletion. No URI fallback, name override or remote escape hatch. Negative tests use in-memory driver doubles: missing mode/URI and unsafe URI open zero connections; unsafe resolved targets, changed configuration/name and replacement connections leave sentinel records untouched. No credentials printed. |
| R1 — variant restoration | Admin-only `PATCH /admin/variants/:id/restore`; Zod id validation and existing auth/admin middleware. Transaction updates the existing archived document through an `archivedAt` guard, preserving id, SKU, stock and order references. Parent existence checked and parent version written to serialize deletion; publication status unchanged. Full SKU and product/size/color uniqueness retained, including archived documents; no partial index. Repeated restore succeeds; unsafe restoration conflicts return 409; missing variant returns 404. Existing admin table exposes Restore, busy disabling and success/error notices. |
| R3 — capability cleanup | Connect and inspection failures close the connection; capability state reset before connect and before disconnect. Capabilities are tied to the actual connected Db object and hidden after connection loss/replacement. Health returns 503 with false transaction support after failure. Unsupported topology still fails fast. Connection, inspection, unsupported-topology and disconnect failures injected in unit tests. |
| R4 — stock restoration | Customer/admin restoration loops both check `matchedCount`, preserving transactional status/stockRestored guards. Both paths tested with matched-but-unmodified results, repeated cancellation and a later missing variant after an earlier stock update; the entire cancellation rolls back. Normal cart/order validation continues to reject invalid quantities; only explicit legacy fixtures bypass it. |
| R5 — preview URL | Explicit production/preview origins require HTTPS and reject localhost, loopback ranges, IPv6 and mapped loopback addresses. Preview fallback requires a valid HTTPS Vercel origin; invalid explicit configuration cannot fall back. Production still requires its explicit canonical origin. Development retains localhost support. |

## Exact verification results

All results below were executed on the corrected working tree, not inherited from the historical report.

| Command/check | Exit | Result |
|---|---|---|
| Server `npm.cmd test` | 0 | **73 tests: 73 pass, 0 fail, 0 skipped, 0 cancelled**; 20 suites |
| Client `npm.cmd test` | 0 | **19 tests: 19 pass, 0 fail, 0 skipped, 0 cancelled**; 2 suites |
| Server `npm.cmd run type-check:test` | 0 | Tests and application type-check |
| Server `npm.cmd run type-check`, `lint`, `build` | 0 each | All pass |
| Client `npm.cmd run type-check`, `lint`, `build` | 0 each | All pass; production build uses the explicit HTTPS canonical origin and unreachable local API override, without contacting production |
| Real HTTP checkout errors | pass | 409 `CART_NOT_ORDERABLE` + per-line details; 409 `CHECKOUT_IN_PROGRESS`; forced cart CAS failure gives 409 `CHECKOUT_CONFLICT` with order/stock/cart rollback and claim release |
| Real HTTP restore authorization | pass | Guest 401; customer 403; admin invalid id 400; valid admin 200 with unchanged identity/SKU/stock |
| Integration/concurrency | pass | Disposable MongoDB 8.2.6 replica set, `rs0`, port 28318; standalone guard on 28319; `_test` databases only. Actual replica-set dbpath verified against this run's temporary directory before fixtures. |
| Required race regressions | pass | Checkout/delete (4 rounds), cancel/delete, restore/delete and repeated restores (4 rounds), restore/checkout, restore/product-delete; concurrent cart add (5 rounds), first-cart race (12 calls), replay and forced transaction rollback retained |
| `git diff --check` | 0 | No whitespace errors |
| Full tracked diff + new sources review | pass | No unrelated change introduced, no dependency additions, no authorization regression; credential-value comparison against local env files found **0 leaks** without printing values |
| Protected audit | pass | `AUDIT_REPORT.md` unchanged: SHA256 `95E5F6BFA80C059E0108A825B99DEDE6389B6F9D82E55EBE5D477948060F44AF` |

Server count reconciliation: capability classification **6** + cart-version filters **2** + connection/readiness failures **7** + database safety **18** + topology **2** + order/integration/HTTP **38** = **73**. Client URL/consumer tests = **19**. Total unique tests = **92**. Parameterized actor cases and loop iterations are not counted as extra tests. Earlier 31-server/13-client counts describe the earlier patch. An intermediate corrective run passed 72 server tests; the final connection-replacement safety case raised that count to 73.

The initial sandboxed `tsx` run failed before loading tests because Node's OS-user lookup returned ENOMEM. The authorized run outside the sandbox passed. A test-only TypeScript cast was corrected before the final test type-check. The client emits Node's informational module-type inference warning; it does not fail tests or lint.

## Files in this corrective patch

- Server behavior: `src/config/db.ts`, `src/controllers/health.controller.ts`, `src/controllers/admin.controller.ts`, `src/routes/admin.routes.ts`, `src/services/admin-catalog.service.ts`, `src/services/order.service.ts`, `src/services/admin-order.service.ts`.
- Server tests/tooling: `test/guards/test-database.ts`, `test/helpers/test-db.ts`, `test/helpers/mock-connection.ts`, `test/test-database-guard.test.ts`, `test/db-connect.test.ts`, `test/order-integrity.test.ts`, `test/topology-guard.test.ts`, `test/setup-env.ts`, `test/README.md`, `package.json`, `.env.example`.
- Client behavior/tests: `components/admin/VariantManager.tsx`, `lib/api/admin.ts`, `lib/site-url.ts`, `lib/__tests__/site-url.test.ts`, `.env.example`.
- Documentation: `API_DOCUMENTATION.md`, `DEPLOYMENT.md`, this report, `REVIEW_REPORT_PHASE0.md` and a final snapshot appended to `REVIEW_PACKAGE_PHASE0.md`. Earlier Phase 0 changes remain present and uncommitted; `PROJECT_CONTEXT.md`, other existing client/server modifications and `AGENTS.md` were preserved.

## Remaining risks and handoff

No remaining R1–R5 blocker. Validation uses a disposable single-node replica set; it does not simulate managed multi-node failover. The Restore UI was reviewed in source and included in passing client checks/build; no interactive browser run was performed. Restoration leaves draft/archived products unpublished; publishing continues through the existing admin workflow. The earlier informational R6/R8/R9 behaviors remain outside this corrective scope. Production topology/configuration was not changed or reverified.

Temporary processes, dbpaths, probe scripts and the generated PowerShell cache are removed before handoff; only durable tests and reports belong to the patch. No fixture records were written outside the disposable databases. **Stop here for owner approval; do not commit.**

---

# Historical Phase 0 — Implementation & Verification Report

**Baseline:** `main` @ `f39ac2a` (confirmed with `git rev-parse HEAD` before any change)
**Work branch:** `fix/audit-p0-order-integrity` (created from that commit; worktree clean apart from untracked `AGENTS.md` and `AUDIT_REPORT.md`)
**Scope:** A1, A5, B1, B2, B3, A4 — nothing else
**Status:** code complete, runnable gates green, **DB-backed regression suite written but blocked in this environment** (no local MongoDB binary/Docker; production Atlas is off-limits for test writes)
**Not done (by instruction):** no commit, no push, no merge, no deploy, no production writes, no production seed, no secret/env changes; `AUDIT_REPORT.md` untouched and still untracked.

---

## 1. Findings → fixes

### A1 — Transactions require a replica set, but the project documented standalone Mongo
- **Root cause:** checkout/cancel/admin-status were upgraded to `session.withTransaction()` while `PROJECT_CONTEXT.md` (§6/§9) and `server/.env.example` still described a standalone server with compensating rollback. Nothing inspected the topology, so a standalone deployment only failed at checkout time with a 500.
- **Fix (keep transactions — approved decision):**
  - New `server/src/config/mongo-capabilities.ts`: pure classifier for the `hello` response (`replica-set` / `sharded` / `standalone` / `unknown` + session support), a read-only `readDeploymentCapabilities(db)`, and a diagnostic that prints the executable local replica-set commands.
  - `server/src/config/db.ts`: `connectDB({ requireTransactions = true })` inspects the deployment after connecting and **refuses to continue** when transactions are unsupported (disconnects, then throws the diagnostic). `getDeploymentCapabilities()` exposes the result; `disconnectDB()` clears it.
  - `server/src/controllers/health.controller.ts`: readiness now returns `{ ok, transactions }` (additive, no secrets).
  - Maintenance scripts (`seed`, `set-role`, `normalize-variants`) use `connectDB({ requireTransactions: false })` — they do not run transactions and must stay usable; the API itself never opts out.
  - Docs/env: `server/.env.example`, `DEPLOYMENT.md` (new “Local database (replica set required)” section), `PROJECT_CONTEXT.md` §6/§9.
- **Production topology verified read-only** against the configured Atlas cluster (no URI/credentials printed, no writes): `setName` present, not sharded, `logicalSessionTimeoutMinutes: 30` → `supportsTransactions: true`; a transaction was started, used for one read and **aborted**.

### A5 — Deleting a variant used by an order destroyed stock restoration
- **Root cause:** `deleteVariant` only checked “is a sibling left?” and then hard-deleted; both cancellation paths restored stock with `$inc` without checking that the document still existed.
- **Fix (archive when history references it):**
  - `Variant` model gains `archivedAt: Date | null` (default `null`; `{ archivedAt: null }` also matches legacy documents, so no migration).
  - `deleteVariant` is now a transaction that **writes the variant first** (`archivedAt`) and then re-checks order references inside the same session. That write is the conflict surface with a concurrent checkout decrementing the same document: the two serialise, so either the order is visible on retry (→ archive) or the deletion commits first and checkout's guarded decrement fails safely.
    - Referenced by orders → archive, return `{ deleted: false, archived: true, orderCount }`; document **and stock** are retained.
    - Not referenced → hard delete, allowed only when another purchasable (non-archived) variant remains; otherwise 409.
  - `deleteProduct` is transactional too: archive when orders reference the product, else cascade-delete variants inside the transaction (Cloudinary public ids captured before deletion, cleaned up best-effort after commit).
  - Both cancellation paths **check the write result**: a missing variant aborts the transaction with `409 STOCK_RESTORE_FAILED`; the order stays `pending` and is never reported as cancelled.
  - Archived variants are excluded from the PDP, catalog aggregation, cart resolution, checkout validation, admin variant stats, low-stock listing and the publish guard. `VariantAdminDto.archivedAt` + an “Archived” badge in the admin UI.
- **Tests:** order → delete (archived, stock intact) → cancel → exact stock; hard delete without orders; last-purchasable-variant refusal; cancellation abort when the document is gone.

### B1 — Cart mutations overlapping checkout could be silently erased
- **Root cause:** the checkout claim only guarded against a second *checkout*; the five cart writes used `cart.save()` unconditionally, and checkout built the order from a pre-claim snapshot and then cleared the cart.
- **Fix (claim + optimistic version protocol):**
  - `Cart` model gains `version` (default 0; no migration for the same reason as A5).
  - New `server/src/config/checkout.ts` holds the shared constants (`CHECKOUT_CLAIM_STALE_MS = 60s`, attempt count, message) used by both services.
  - `cart.service.mutateCart()` is the only write path: reject with `409 CHECKOUT_IN_PROGRESS` while a non-stale claim exists, otherwise compare-and-swap on `{ _id, version, claim empty-or-stale }` with `$inc: { version: 1 }`, retrying on a lost race. `addItem`, `updateItem`, `removeItem`, `clearCart` and `mergeGuestItems` all go through it (the guest merge resolves variants first, then applies one mutation).
  - Carts created before this change have **no stored `version`**, so the CAS accepts `version: 0` *or* a missing field (`cartVersionFilter`) — existing carts stay mutable instead of failing every write.
  - `createOrder` **re-reads the cart inside the transaction** and clears with a CAS on `checkoutInProgress: claimTime` **and** the claim-time `version`, releasing the claim atomically; a mismatch aborts with `409 CHECKOUT_CONFLICT`. The existing timestamp-matched release in `finally` remains.
  - Client: checkout maps `CHECKOUT_IN_PROGRESS` / `CHECKOUT_CONFLICT` to actionable retry copy.
- **Tests:** all five mutations rejected during an active claim; accepted when the claim is stale; 5 rounds of `createOrder` vs `addItem` racing with the invariant “every line is accounted exactly once in cart ∪ order, stock never negative”; `checkoutId` replay does not double-decrement.

### B2 — First-cart upsert race could 500
- **Root cause:** `findOneAndUpdate(..., { upsert: true })` against the unique `user` index is not atomic for two first-time requests; Mongoose does not retry `E11000`.
- **Fix:** `getOrCreateCart` reads first; on insert it catches **only** code `11000` and returns the winner's cart. Other errors propagate.
- **Tests:** 12 concurrent first `getCart` calls → zero failures, exactly one cart document; per-user isolation.

### B3 — Checkout accepted unavailable / priceless lines
- **Root cause:** line validation existed only on the cart page; the order service checked existence/status superficially, never re-checked stock at build time, never validated the price, and used the pre-claim snapshot.
- **Fix:** `buildOrderItems` is the single validator and runs **twice** — before the claim (fast, actionable) and inside the transaction (authoritative). Per line: positive integer quantity, variant exists, variant not archived, product exists and is `active`, price is a positive integer in poisha, `stock >= quantity`. All issues are returned together as `409 CART_NOT_ORDERABLE` with `details[]` (`{ path: 'items', message: 'SKU…: reason' }`); no order, no stock change, claim released, cart preserved. The client renders the per-line reasons under the conflict notice.
- **Tests:** archived variant, unpublished product, quantity above stock (message names the available amount), missing/zero price, plus a valid COD order asserting server-computed subtotal/total and snapshot fields.

### A4 — `NEXT_PUBLIC_SITE_URL` silently produced localhost URLs
- **Root cause:** `new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')` — no validation, no production guard.
- **Fix:** new `client/lib/site-url.ts` (`resolveSiteUrl`, `isLoopbackHostname`), used by `client/lib/seo.ts`. Production builds (`NODE_ENV=production`, excluding Vercel previews) require an absolute **https**, non-loopback origin and throw an actionable error otherwise; previews fall back to their own `https://$VERCEL_URL`; development keeps the localhost default. Metadata/canonical/OpenGraph, `robots.ts` and `sitemap.ts` all derive from `SITE_URL`/`absoluteUrl`.
- **Tests:** 13 client tests (missing, localhost, loopback IPs, `http`, non-absolute, valid https, dev defaults, preview fallback) plus source-contract tests that consumers keep using `@/lib/seo` and that the hard-coded localhost fallback is gone.

---

## 2. Changed files

**Server (behaviour):**
`src/config/checkout.ts` (new) · `src/config/mongo-capabilities.ts` (new) · `src/config/db.ts` · `src/controllers/health.controller.ts` · `src/controllers/admin.controller.ts` · `src/models/cart.model.ts` · `src/models/variant.model.ts` · `src/services/cart.service.ts` · `src/services/order.service.ts` · `src/services/admin-order.service.ts` · `src/services/admin-catalog.service.ts` · `src/services/product.service.ts` · `src/scripts/{seed,set-role,normalize-variants}.ts` (connect option only)

**Server (tests/tooling):**
`test/setup-env.ts` (new) · `test/mongo-capabilities.test.ts` (new) · `test/checkout-version-filter.test.ts` (new) · `test/topology-guard.test.ts` (new) · `test/order-integrity.test.ts` (new) · `test/README.md` (new) · `tsconfig.test.json` (new) · `package.json` (test scripts)

**Server also gained** `connectDB({ uri })` so tests can target a specific topology without touching `env.MONGODB_URI`.

**Client:**
`lib/site-url.ts` (new) · `lib/seo.ts` · `lib/__tests__/site-url.test.ts` (new) · `lib/types/api.ts` · `lib/types/admin.ts` · `lib/api/admin.ts` · `components/admin/VariantManager.tsx` · `components/checkout/CheckoutClient.tsx` · `package.json` (test script) · `tsconfig.json` (`allowImportingTsExtensions` for the native-Node test import)

**Docs/env:** `API_DOCUMENTATION.md` · `DEPLOYMENT.md` · `PROJECT_CONTEXT.md` · `server/.env.example` · `client/.env.example`

Untracked and intentionally not part of the change set: `AGENTS.md`, `AUDIT_REPORT.md`, `AUDIT_PHASE0_IMPLEMENTATION_REPORT.md` (this file).

---

## 3. Tests and results (final code, branch `fix/audit-p0-order-integrity`)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `server: npm run type-check` (`tsc --noEmit`) | 0 | no errors |
| 2 | `server: npm run lint` (`eslint .`) | 0 | no errors |
| 3 | `server: npm test` (`node --import tsx --test …`) | 0 | **31/31 pass** with `MONGODB_TEST_URI` + `MONGODB_STANDALONE_URI` set (4 consecutive runs — see §3a); with no test URI the integration suites skip explicitly instead of passing silently |
| 4 | `server: npm run build` (`tsc`) | 0 | dist built |
| 4b | `server: npm run type-check:test` (`tsc -p tsconfig.test.json`) | 0 | the 31-test suite type-checks (previously outside `tsc`’s `src`-only include) |
| 5 | `client: npm test` (`node --test …`) | 0 | **13/13 passed** (A4 guard + consumer contracts) |
| 6 | `client: npm run type-check` | 0 | no errors |
| 7 | `client: npm run lint` | 0 | no errors |
| 8 | `client: npm run build` (`NEXT_PUBLIC_SITE_URL=https://abstract-lifestyle.vercel.app`) | 0 | Next build succeeded |
| 9 | `git diff --check` | 0 | no whitespace errors |
| 10 | Atlas capability probe (read-only, outside the repo) | 0 | replica set + sessions → `supportsTransactions: true`; transaction started/read/aborted |
| 11 | `next start` (built app) → `/sitemap.xml`, `/robots.txt` | 200 | both emit `https://abstract-lifestyle.vercel.app` only — **no localhost** |
| 12 | `NEXT_PUBLIC_SITE_URL=http://localhost:3000 → next build` **(negative)** | 1 | fails as designed: `NEXT_PUBLIC_SITE_URL must use https in production (received "http://")` + remediation text |
| 13 | `NEXT_PUBLIC_SITE_URL=https://abstract-lifestyle.vercel.app → next build` | 0 | build succeeds and `.next` is left in a good state |

**Not executed (blocked, not passed):** none. The suite was executed against a disposable replica set; see §3a.

### 3a. Executed integration/concurrency verification

**Environment (created for this run, deleted afterwards):** official MongoDB 6.0.24 Windows binaries extracted to `%TEMP%\p0-mongo` (only `mongod.exe`, taken from the vendor ZIP; no installer, no service, no PATH change, nothing added to the repo), a single-node replica set `rs0` on `127.0.0.1:27018` and a plain standalone `mongod` on `127.0.0.1:27019`, both with throwaway dbpaths under `%TEMP%`. Production Atlas was **not** used for any test.

```
mongod --replSet rs0 --port 27018 --dbpath %TEMP%\p0-rs --bind_ip 127.0.0.1
mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"   -> primary=true setName=rs0 sessions=30
mongod --port 27019 --dbpath %TEMP%\p0-sa --bind_ip 127.0.0.1                                     (standalone, guard test)
MONGODB_TEST_URI=mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true
MONGODB_STANDALONE_URI=mongodb://127.0.0.1:27019/p0_integrity_standalone
```

**Result: 31 tests, 31 passed, 0 failed — 4 consecutive runs (stability), exit 0.**

| Suite | Tests | Outcome |
|---|---|---|
| A1 — capability classification (pure) | 6 | pass |
| A1 — cart version CAS filter (pure) | 2 | pass |
| A1 — startup refuses standalone (`connectDB` rejects, no connection, no order reads) | 1 | pass |
| A1 — startup accepts replica set (`transactions: true`, ping) | 1 | pass |
| A5 — order → delete → archive → cancel restores stock | 1 | pass |
| A5 — hard delete without orders / last-variant refusal | 2 | pass |
| A5 — cancellation aborts when the variant is gone | 1 | pass |
| A5 — cancel vs delete race, checkout vs delete race (×4 rounds) | 2 | pass |
| B1 — all five mutations rejected during a claim | 1 | pass |
| B1 — stale-claim recovery | 1 | pass |
| B1 — concurrent addItem vs createOrder (5 rounds, cart ∪ order invariant) | 1 | pass |
| B1 — checkoutId replay (one order, one decrement) | 1 | pass |
| A1/B1 — forced order-insert failure after the decrement → full rollback + retry | 1 | pass |
| A5 — double cancellation restores exactly once | 1 | pass |
| B2 — 12 concurrent first-cart requests → one cart, no failures | 1 | pass |
| B2 — per-user isolation | 1 | pass |
| B2 — duplicate-key policy (11000 unrecoverable → rethrow; other codes → rethrow) | 1 | pass |
| B3 — archived variant / unpublished product / over-stock / priceless line / invalid quantity | 5 | pass |
| B3 — valid COD order (server prices, snapshot, cart cleared) | 1 | pass |

One failure was found and fixed **in the test fixture only** (the variant schema upper-cases SKUs, so the expected snapshot value had to come from the stored document); no production defect was exposed by it.

How to reproduce:

```powershell
# disposable single-node replica set on a spare port/dbpath
mongod --replSet rs0 --port 27018 --dbpath .\.p0-test-data
mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"

$env:MONGODB_TEST_URI = 'mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true'
$env:MONGODB_STANDALONE_URI = 'mongodb://127.0.0.1:27019/p0_integrity_standalone'   # optional: A1 guard test
npm --prefix server run test
```


---

### 3b. Owner verification matrix (executed)

| Finding | Scenario | Result |
|---|---|---|
| A1 | Standalone Mongo + transactions required | **PASS** — `connectDB()` rejects with the actionable diagnostic, connection closes (`readyState 0`), no capability published, order reads fail |
| A1 | Single-node replica set | **PASS** — connects, `transactions: true`, `setName rs0`, ping ok; COD create/cancel run inside transactions (A5/B3 suites) |
| A1 | Forced transaction failure after first stock decrement | **PASS** — order insert forced to fail after the decrement: stock rolled back to 5, no order row, cart intact, claim released, retry then succeeds |
| A5 | Order references variant; admin deletes it | **PASS** — archived (`orderCount 1`), document + stock retained |
| A5 | Cancel after archive | **PASS** — status `cancelled`, stock restored exactly once to 10, second cancel 409 with no further restore |
| A5 | Concurrent checkout vs delete/archive | **PASS** (4 rounds) — either an order exists with an archived variant and stock decremented once, or no order and the variant is deleted; never an order pointing at a missing variant; stock never negative |
| A5 | Concurrent cancel vs delete/archive | **PASS** — cancel succeeds with exactly one restore and the variant archived; otherwise cancel stays clearly rejected and nothing is partially restored |
| B1 | Add item while checkout claim active | **PASS** — 409 `CHECKOUT_IN_PROGRESS`, cart unchanged |
| B1 | Update/remove/clear/merge while claim active | **PASS** — all four rejected with the same code; cart unchanged |
| B1 | Guest merge while checkout active | **PASS** — rejected, no line overwritten (merge is one CAS mutation) |
| B1 | Checkout fails / retries / replays | **PASS** — claim released after failure, retry succeeds, replay returns the same order with one stock decrement |
| B2 | 10+ concurrent first-cart requests | **PASS** — 12 concurrent calls, zero failures, exactly one cart |
| B2 | Duplicate key on an unrelated/unrecoverable path | **PASS** — `11000` with no cart to fall back to is rethrown; code `121` propagates unchanged |
| B3 | Direct checkout: disabled/unpublished/out-of-stock variant | **PASS** — structured `CART_NOT_ORDERABLE` + `details[]`, no order, no stock change |
| B3 | Missing/invalid price or quantity | **PASS** — priceless line rejected; quantity 0 rejected; no ৳0 order |
| B3 | Normal COD checkout | **PASS** — server-computed subtotal/total (24000/24000), snapshot SKU/name/price, stock 5→3, cart cleared |
| A4 | Production build without `NEXT_PUBLIC_SITE_URL` | **PASS (unit + build path)** — resolver throws; in this workspace `.env.local` supplies `http://localhost:3000`, whose build-level failure is proven below |
| A4 | Production URL `http://localhost:3000` | **PASS** — `next build` exits 1 with `must use https in production ...` |
| A4 | Production URL `https://abstract-lifestyle.vercel.app` | **PASS** — build 0; served `/sitemap.xml` and `/robots.txt` contain only that origin |
| Cross-cutting | Typecheck, lint, server tests, client build | **PASS** — see §3 (all exit 0) |
| Cross-cutting | `git diff --check` / secret / dependency review | **PASS** — clean; no `sk-`/`mongodb+srv`/password strings in the diff; no dependency added (`git diff -- package.json` only adds `test` scripts); `AUDIT_REPORT.md` untouched |

---

## 4. Unresolved concerns / remaining risks

1. **DB-backed verification — done, with one caveat.** 31/31 tests ran against a disposable replica set (4 consecutive runs). The test server was MongoDB **6.0.24** while production is Atlas 8.x: the exercised semantics (transactions, write conflicts, unique indexes, `$inc`/CAS) are identical, but a rerun against the production-major version on a staging cluster is advisable.
2. **Local `next build` now requires an absolute https `NEXT_PUBLIC_SITE_URL`.** `client/.env.local` currently sets `http://localhost:3000`, so a local production build fails with the guard’s message until that value is changed (or the variable is passed inline). This is the intended guard, but it is a workflow change the owner must accept (see §8).
3. **Vercel preview builds**: when `NEXT_PUBLIC_SITE_URL` is not set for the Preview environment, the build uses `https://$VERCEL_URL`; explicit production URLs on previews are used as given.
4. **Archived variants keep their stock** (by design, so cancellations can restore it). They are excluded from pricing/availability everywhere, but `variantStats`/publish-guard/lookups now filter on `archivedAt`; any external reporting query that counts variants must apply the same filter.
5. **`deleteProduct` is now transactional.** On a non-replica-set deployment the API no longer starts at all (A1), so this cannot regress into a runtime error.
6. **`stockRestored`/`STOCK_RESTORE_FAILED`** aborts a cancellation for legacy orders whose variants were hard-deleted before this change. Such orders can no longer be cancelled through the API until the data is reconciled (they stay `pending`); an admin-side manual correction is a separate decision.
7. **No API-level (HTTP) tests** for the new 409 codes — the service layer is covered; the controller/route mapping was reviewed and type-checked only.
8. **`client/tsconfig.json` gained `allowImportingTsExtensions`** so the native-Node test can import the module with its extension. It has no effect on the Next build (`noEmit`).

---

## 5. Rollback plan

The work is uncommitted on a dedicated branch. Rollback is therefore trivial and non-destructive:

```powershell
git switch main                  # leave the branch untouched
git branch -D fix/audit-p0-order-integrity   # only after review/abandonment
```

Nothing was pushed, merged, deployed or written to production, so no production rollback is required. If this branch is later merged and a revert is needed, the changes are additive at the schema level (`archivedAt`, cart `version` both default safely for existing documents) and the commit can be reverted without a data migration.

---

## 6. Production environment checklist

- [ ] Vercel → **Production** env: `NEXT_PUBLIC_SITE_URL=https://abstract-lifestyle.vercel.app` (absolute https; the build now fails otherwise).
- [ ] Vercel → Preview (optional): leave it unset (uses `VERCEL_URL`) or set an explicit https origin.
- [ ] Render → `MONGODB_URI` must be a replica-set URI (Atlas `mongodb+srv://…` already is).
- [ ] After deploy: `GET /api/health` → `{ "ok": true, "transactions": true }`.
- [ ] Do not run the production seed; no migration is required for this change.

---

## 7. Owner decisions needed

1. **A4 workflow change (needs a yes/no):** the guard now fails *any* production build whose `NEXT_PUBLIC_SITE_URL` is missing/http/localhost — including a local `next build` while `client/.env.local` says `http://localhost:3000`. Options:
   (a) accept it and update the local `.env.local` to the https origin (my recommendation), or
   (b) scope strictness to `VERCEL_ENV=production` only (weaker for self-hosted production).
2. **Legacy orders with deleted variants** (§4.6): leave them non-cancellable (current behaviour, honest) or add an admin reconciliation path in a later phase?
3. **Archived variants visibility:** they are hidden from the storefront and from low-stock monitoring but listed (badged) in the product’s variant table. Confirm that is the desired admin UX, or move them behind a “show archived” toggle.
4. **DB test execution — done** in this session with a disposable local replica set (see §3a). Re-run it in CI (or against a staging cluster) as part of the merge gate.

---

## 8. Final summary

**(1) Findings/fixes — 6 items**
A1 startup guard + capability classification + docs; A5 archive-instead-of-delete with transactional serialisation and strict stock-restore checks; B1 claim + version CAS on every cart write and a CAS checkout clear; B2 E11000 recovery; B3 authoritative per-line checkout validation with actionable `details[]`; A4 production SEO URL guard.

**(2) Diffstat**

```
27 files changed, 625 insertions(+), 152 deletions(-)   (tracked files)
new (untracked, intentional):
  server/src/config/{checkout.ts, mongo-capabilities.ts}
  server/test/{setup-env.ts, mongo-capabilities.test.ts, checkout-version-filter.test.ts, topology-guard.test.ts, order-integrity.test.ts, README.md}
  server/tsconfig.test.json
  client/lib/site-url.ts
  client/lib/__tests__/site-url.test.ts
untouched: AUDIT_REPORT.md, AGENTS.md, AUDIT_PHASE0_IMPLEMENTATION_REPORT.md
```

**(3) Test table** — see §3: server type-check/lint/build **0**, server tests **8/8 unit pass**, client tests **13/13 pass**, client type-check/lint/build **0**, `git diff --check` **0**, read-only Atlas capability probe **ok**, negative SEO build **fails as designed**, positive build **0**, served sitemap/robots contain no localhost. Integration suite: **not run** (blocked, no disposable MongoDB).

**(4) Remaining risks / blocked tests** — see §4; the only blocking item is the unexecuted DB suite; plus the A4 local-build workflow change and the legacy-order cancellation edge case.

**(5) Verdict: READY FOR REVIEW** — all six findings implemented; **31/31** integration/concurrency tests pass against a disposable replica set (4 consecutive runs) and every repo gate is green; scope is clean (no dependency added, no secret, no production write). Nothing was committed, pushed, merged or deployed — owner review is the remaining gate.

**Next step requested:** review the diff, then authorise the commit (and Phase 1).



