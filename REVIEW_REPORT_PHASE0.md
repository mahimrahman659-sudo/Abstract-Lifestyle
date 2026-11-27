# Phase 0 — Final Corrective Review (2026-11-17)

**Final verdict: PASS for R1–R5; awaiting owner approval.** `fix/audit-p0-order-integrity` @ `f39ac2a`, all changes uncommitted. This final corrective verification supersedes the conditions and counts in the historical independent review below. It was performed by the implementing agent, not a new independent reviewer.

| Finding | Status | Verified outcome |
|---|---|---|
| R2 — destructive test database safety | **Corrected** | Explicit disposable mode + designated local `_test` URI, no application-URI fallback or remote override. Driver-resolved database/host and approved connection identity checked before deletion. Production/staging/system targets refused. Negative tests use only in-memory doubles and prove zero lost sentinel records, including missing configuration and a replacement connection with the same name. |
| R1 — archived variant restoration | **Corrected** | Secure admin PATCH endpoint and visible Restore action; existing id/SKU/stock/history retained. Transaction guards the archived state and parent existence against deletion. Publication status and full unique indexes preserved. Repeated restore, history cancellation, restore/delete, restore/checkout and product-delete races pass. HTTP auth gates: 401/403/400/200. |
| R3 — connection/capability cleanup | **Corrected** | Connection and inspection errors disconnect and clear capabilities. Connection-bound cache cannot report stale support after loss/replacement. HTTP health fails readiness with false transaction support. Unsupported MongoDB still refused. |
| R4 — stock restoration result | **Corrected** | Both restoration paths use `matchedCount`, retaining exactly-once guards and transaction atomicity. Both actors pass zero-change and later-missing-variant rollback tests. Invalid checkout quantities remain rejected. |
| R5 — preview origins | **Corrected** | Preview rejects explicit non-HTTPS/localhost/loopback origins and unsafe inferred origins; valid HTTPS preview fallback works. Production canonical configuration remains mandatory; development localhost preserved. |

Final executed results: **73/73 server** + **19/19 client** = **92/92 unique tests**, zero failures/skips/cancellations. Server reconciliation: 6 capability + 2 CAS + 7 cleanup/readiness + 18 safety + 2 topology + 38 integration/HTTP. All server/client type-check, lint and build commands exit 0; server tests also type-check. Required checkout 409s, checkout/delete and cancel/delete regressions pass against a disposable MongoDB 8.2.6 replica set, with standalone refusal tested separately. Full diff/new-source review, local-credential leak comparison and `git diff --check` pass; no dependencies added or auth weakened.

Scope and residual limits: single-node local replica-set coverage; no interactive browser verification of the Restore button. R6/R8/R9 informational behaviors from the historical review are unchanged. No production database writes/configuration changes, no Phase 1, no commit/push/merge/deploy. `AUDIT_REPORT.md` hash remains `95E5F6BFA80C059E0108A825B99DEDE6389B6F9D82E55EBE5D477948060F44AF`; existing unrelated changes preserved. Details, corrective file inventory and command results are in `AUDIT_PHASE0_IMPLEMENTATION_REPORT.md`.

**Owner approval is the next step.**

---

# Historical Phase 0 — Independent Read-Only Code Review

**Repository:** `C:\Project\Abstract Lifestyle` · **Branch:** `fix/audit-p0-order-integrity` · **HEAD:** `f39ac2a` (baseline confirmed, nothing committed)
**Scope:** A1, A5, B1, B2, B3, A4 + the requested cross-cutting checks.
**Method:** full read of the working-tree diff and every new file, plus targeted verification of surrounding code paths (Express 5 error handling, admin routing/auth, client API layer, PDP empty-variant handling, SEO consumers, ignore rules, dependency/env diffs, test inventory). Read-only: no source, config, env or data was modified.
**Artifacts:** this report + `REVIEW_PACKAGE_PHASE0.md` (tracked diff + all 11 new files; no credentials). `AUDIT_REPORT.md` (hash `95E5F6BF…`) and `AUDIT_PHASE0_IMPLEMENTATION_REPORT.md` were not modified.

---

## 1. Files and functions reviewed

**Server — changed (13)**
| File | Functions/lines reviewed |
|---|---|
| `server/src/config/db.ts` | `connectDB` (whole), `getDeploymentCapabilities`, `disconnectDB` |
| `server/src/config/checkout.ts` | constants, `cartVersionFilter` |
| `server/src/config/mongo-capabilities.ts` | `classifyDeployment`, `readDeploymentCapabilities`, `transactionRequirementMessage` |
| `server/src/controllers/health.controller.ts` | `isDatabaseReady`, `getHealth` |
| `server/src/controllers/admin.controller.ts` | `deleteVariantHandler` |
| `server/src/models/cart.model.ts` | `version`, item sub-schema (`min: 1`), indexes |
| `server/src/models/variant.model.ts` | `archivedAt`, `{product,size,color}` unique index |
| `server/src/services/cart.service.ts` | `getOrCreateCart`, `mutateCart`, `hasActiveCheckout`, `findAvailableVariant`, `buildCartView`, `addItem`, `updateItem`, `removeItem`, `clearCart`, `mergeGuestItems` |
| `server/src/services/order.service.ts` | `buildOrderItems`, `createOrder` (replay → pre-check → claim → transaction → CAS clear → release), `cancelOrder` |
| `server/src/services/admin-order.service.ts` | `adminUpdateOrderStatus` (guarded transition + restore) |
| `server/src/services/admin-catalog.service.ts` | `deleteVariant`, `deleteProduct`, `toVariantDto`, `variantStats`, `updateProduct` publish guard, `listVariants`, `ensureUniqueVariant`, `createVariant` |
| `server/src/services/product.service.ts` | catalog aggregation (`$lookup` + archived `$filter`), `getProductBySlug`, `listSitemapProducts` |
| `server/src/scripts/{seed,set-role,normalize-variants}.ts` | connect option only |

**Server — new (7):** `test/setup-env.ts`, `test/mongo-capabilities.test.ts`, `test/checkout-version-filter.test.ts`, `test/topology-guard.test.ts`, `test/order-integrity.test.ts`, `test/README.md`, `tsconfig.test.json`.

**Client — changed (8):** `lib/seo.ts`, `lib/site-url.ts` (new), `lib/types/api.ts`, `lib/types/admin.ts`, `lib/api/admin.ts`, `components/admin/VariantManager.tsx`, `components/checkout/CheckoutClient.tsx`, `package.json`, `tsconfig.json`, `lib/__tests__/site-url.test.ts` (new).

**Context checked (unmodified):** `middleware/error-handler.ts`, `index.ts`, `app.ts`, `routes/admin.routes.ts`, `routes/cart.routes.ts`, `controllers/cart.controller.ts`, `lib/api/client.ts`, `components/ui/Notice.tsx`, `components/cart/{CartPageClient,CartProvider}.tsx`, `components/catalog/{PurchasePanel,ProductSelection}.tsx`, `app/{layout,sitemap,robots}.ts*`, both `.env.example`, `.gitignore`, `server/package.json` (express 5.3, mongoose 9.12), docs.

---

## 2. Confirmed findings

Nothing found in the security or stock/order-integrity core. Nine items; none blocking (2 medium operational gaps, 3 low, 4 informational).

### R1 — MEDIUM (operational, introduced by A5): an archived variant permanently blocks re-creating that size/colour
- **Where:** `server/src/services/admin-catalog.service.ts:577-587` (`ensureUniqueVariant` combo lookup — no `archivedAt` filter), `server/src/models/variant.model.ts:46` (unique `{product:1,size:1,color:1}` index — no partial filter), archive path `admin-catalog.service.ts:847-852`; no restore endpoint exists.
- **What happens:** after a variant is archived for order history, `POST /admin/products/:id/variants` with the same size + colour returns `409 A variant with this size and color already exists`; the same SKU returns `SKU already exists`. There is no API/UI path to reactivate the archived variant, so an admin cannot re-list a size/colour they previously retired (workaround: edit the archived variant's size/colour, or edit the database).
- **Why:** archiving keeps the document (correct for stock restoration) but the uniqueness rules were written for hard deletes.
- **Not an integrity defect:** the historical document and its stock stay valid; restoration tests pass.
- **Evidence:** index definition + unfiltered lookup; `listVariants` hides archived (`:900`) while `getProductAdmin` shows them badged — the conflict is visible but unresolvable.

### R2 — MEDIUM (test-tooling safety): the integration suite wipes whatever database `MONGODB_TEST_URI` names
- **Where:** `server/test/setup-env.ts:13-14`, `server/test/order-integrity.test.ts` → `resetDatabase()` deletes every document in every collection (`beforeEach`).
- **What happens:** a mis-set variable (copy/pasted Atlas URI, CI secret pointing at staging) erases all documents in that database with no guard or confirmation. Indexes survive; data does not.
- **Evidence:** code; the only protection is a sentence in `server/test/README.md`.

### R3 — LOW: `connectDB` leaves the connection open (and capabilities stale) if topology inspection throws
- **Where:** `server/src/config/db.ts:35-43`.
- **What happens:** `readDeploymentCapabilities(db)` is outside any try/catch. If `hello` fails (transient error, proxy/Atlas restriction) the function throws **without disconnecting** and without clearing `capabilities` from a previous connection. The API still exits 1 (`index.ts:55-58`), but scripts/tests can hang on an open handle and `/api/health` could report stale `transactions: true`.
- **Evidence:** the disconnect branch is proven on the success path (standalone test asserts `readyState === 0`); the throw path has no cleanup.

### R4 — LOW: restore paths test `modifiedCount`, so a zero-quantity line aborts the cancellation
- **Where:** `server/src/services/order.service.ts:463`, `server/src/services/admin-order.service.ts:122`.
- **What happens:** `$inc: { stock: 0 }` matches but does not modify → `modifiedCount === 0` → `409 STOCK_RESTORE_FAILED`, order stays `pending`. Only reachable with a zero-quantity order line; the cart schema has `min: 1` (`cart.model.ts:27`) and `buildOrderItems` rejects quantity < 1, so legacy/corrupt data only.
- **Correct check:** `matchedCount` (does the variant still exist?) rather than `modifiedCount`.

### R5 — LOW (A4 edge): preview deployments accept an explicit loopback `NEXT_PUBLIC_SITE_URL`
- **Where:** `client/lib/site-url.ts:52` (`strict = nodeEnv === 'production' && vercelEnv !== 'preview'`; the https/loopback checks at `:63-72` run only when strict); preview fallback at `:82`.
- **What happens:** a Preview build with `NEXT_PUBLIC_SITE_URL=http://localhost:3000` (variable scoped to “All Environments”) publishes localhost canonicals/OG/robots in that preview. Production is strict and fails the build — verified.
- **Evidence:** `client/lib/__tests__/site-url.test.ts` deliberately asserts an explicit http value is accepted outside strict mode.

### R6 — INFO: archiving the last sellable variant leaves an `active` product with zero purchasable variants
Archive even when last (`admin-catalog.service.ts:847-852`) is intentional so an order-referenced variant can be retired. The product stays `active`, appears in the catalog with `totalStock 0` and no sizes; the PDP renders out-of-stock safely (`ProductSelection.tsx:21` → `null`; `PurchasePanel.tsx:153` → `outOfStock`). The admin sees `0 variants` but is not prompted to archive the product. Cosmetic only.

### R7 — INFO: local `next start` (not just `next build`) now requires an https `NEXT_PUBLIC_SITE_URL`
`SITE_URL` is module-level and evaluated by `layout.tsx` on the server, so `next start` with `.env.local` = `http://localhost:3000` fails at startup. Intended guard; the A4 docs mention builds only.

### R8 — INFO: `mergeGuestItems` writes (and can 409) even when no guest line is valid
`cart.service.ts:318` always calls `mutateCart`, so a merge with zero valid additions still bumps `version` and can return `409 CHECKOUT_IN_PROGRESS` during checkout (client swallows and refreshes: `CartProvider.tsx:133`).

### R9 — INFO: retry exhaustion returns a generic `CONFLICT`
After 3 CAS collisions `mutateCart` throws `CONFLICT` (“Your cart changed in another request”) instead of `CHECKOUT_IN_PROGRESS`. Actionable, marginally less specific.

---

## 3. Verification evidence per mandatory check

| Check | Evidence |
|---|---|
| **Transaction correctness / retries** | `createOrder` builds and decrements **inside** `withTransaction`; the E11000 path aborts before any retry (no double decrement); `ORDER_NUMBER_ATTEMPTS` retries only order-number collisions; `result.created` is set in the callback but consumed only after a committed transaction (`order.service.ts:276-377`). Forced mid-transaction failure reverts stock and leaves no order. |
| **Startup failure + cleanup** | Standalone: `connectDB` rejects with the replica-set diagnostic, `readyState === 0`, `getDeploymentCapabilities() === null`, order reads fail. Replica set: connects, `transactions: true`, ping ok. Gap → R3. |
| **Archiving / history / exactly-once** | `deleteVariant` writes the variant first (conflict surface), re-checks orders in-session, archives vs deletes; the last-variant rule applies only to hard deletes; both restore paths guard on `status` + `stockRestored` and abort on a missing document; double cancel 409 with no second restore; checkout-vs-delete and cancel-vs-delete races (4 rounds) preserved the invariant. Gaps → R1, R4, R6. |
| **CAS / claim lifecycle / legacy carts** | Every cart write goes through `mutateCart` (claim check + version CAS, 3 attempts); checkout claims atomically, re-reads the cart in-transaction, clears with CAS on claim **and** version, releases only its own timestamp; `cartVersionFilter` covers carts without a stored `version`. |
| **Duplicate-key recovery** | `getOrCreateCart` catches **only** `11000` and returns the winner's cart (12 concurrent first calls → 1 cart, 0 failures); rethrows 11000 when no cart exists and rethrows other codes (121 tested). |
| **Price / quantity / availability / stock** | `buildOrderItems` runs pre-claim and in-transaction: integer quantity ≥ 1, variant exists, not archived, product `active`, price positive integer poisha, stock ≥ quantity, aggregated `details[]`; 5 rejection tests + valid COD test; client prices never trusted. |
| **SEO / preview** | One source (`lib/seo.ts`); production strict (missing/http/localhost/non-absolute throw — 13 client tests, negative build exit 1, positive build 0, served sitemap/robots only the https origin); no other `NEXT_PUBLIC_SITE_URL` reader; `resolveSiteUrl` imported only by server components/routes. Gaps → R5, R7. |
| **HTTP codes** | Express 5 forwards async rejections to `errorHandler` (`app.ts:41-43`), which serialises `code` + `details`; cart page shows `error.message`; checkout maps `CART_NOT_ORDERABLE` (per-line list), `CHECKOUT_IN_PROGRESS`, `CHECKOUT_CONFLICT`. |
| **Test reconciliation** | `order-integrity` 21 `it()`, `topology-guard` 2, `mongo-capabilities` 6, `checkout-version-filter` 2 → **31**; client **13**. The earlier “15” was the original A5+B1+B2+B3 block (4+4+2+5); it later grew by 6 (rollback/retry, double-cancel, two race tests, duplicate-key policy, invalid quantity) = 21. The implementation report’s table also sums to 31 — consistent. Runner: 31/31 pass, 4 consecutive runs, exit 0. |
| **Dependencies / env / secrets / auth / COD** | No dependency added (`package.json` diffs = scripts only); no `any` (single diff hit is the word “any” in a comment); `.env`/`.env.local` untouched + ignored; `.env.example` placeholders only; admin router still `requireAuth + requireRole('admin')` (`admin.routes.ts:42`); cart routes require auth; no changes to auth, payment, order routes or Zod schemas; `paymentMethod` server-restricted; `provider.onOrderPlaced` still after commit. |

---

## 4. Required fixes

**Before merge (conditions)**
1. **R1** — add a restore path for archived variants (`PATCH /admin/variants/:id` accepting `archivedAt: null`, plus a “Restore” action) and/or name the archived variant in the combo conflict. Do **not** make the unique index partial: legacy documents without `archivedAt` would fall out of the index and allow duplicates.
2. **R2** — guard the harness: refuse to run unless the resolved database name ends in `_test` (or the host is localhost), with an explicit `MONGODB_TEST_ALLOW_REMOTE=1` escape hatch; log only the database name.

**Before CI (non-blocking)**
3. **R3** — wrap capability inspection: on error `await mongoose.disconnect(); capabilities = null; throw`; reset `capabilities = null` at the start of `connectDB`.
4. **R4** — use `matchedCount` in both restore loops.

**Documentation / polish (non-blocking)**
5. **R5** — reject loopback hosts in preview too (keep http for development), or drop the test asserting the opposite.
6. **R7** — note that `next start` locally also needs the https origin; **R6** — optionally auto-archive/draft a product when its last sellable variant is archived; **R8/R9** — skip the write when a merge has no valid lines; return `CHECKOUT_CONFLICT` after retry exhaustion.

None of these affects the stock/order invariants behind A1/A5/B1/B3, and none needs a data migration.

---

## 5. Verdict

**PASS WITH CONDITIONS.**

- No blocker or high-severity defect. All six Phase-0 findings are implemented as described and independently reproduced: **31/31** server tests (4 consecutive runs) against a disposable replica set, **13/13** client tests, all build/type/lint gates green, atomic rollback proven, concurrency invariants held.
- Two medium **operational** conditions (R1 restore path, R2 test-DB guard) and four low/informational items must be addressed; none is an integrity or security risk and none invalidates the Phase-0 fixes.
- Scope clean: no dependency, no secret, no production write, no route/auth/payment change, both audit reports untouched, nothing committed or pushed.


