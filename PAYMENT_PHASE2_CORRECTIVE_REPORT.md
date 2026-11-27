# Phase 2 corrective patch report — H1, H2, H3 and medium findings

- Repository: `C:\Project\Abstract Lifestyle`
- Branch: `feature/manual-mfs-payments`
- Baseline/HEAD: `2e433dfcaee1927165ee161980c5e5ba57468516`
- Worktree: Phase 2 remains uncommitted; no commit, push, merge, rebase or deploy
  was performed.
- Providers remain disabled by default. No provider was activated and no real
  financial transaction or production database/index operation was performed.
- Disposable verification used MongoDB 8.2.6 on loopback port 27018 with
  temporary dbpaths outside the repository; all services and dbpaths were
  removed afterwards.

## 1. Verdict

**PASS WITH CONDITIONS**

H1 and H2 are implemented and independently testable. The branch-history issue
(H3) is analysed and an integration procedure is documented, but no branch
operation was executed as required. Production index creation and owner policy
approvals remain outstanding.

---

## 2. H1 — Payment unique-index readiness

### Implementation

- Added `server/src/config/payment-index.ts`:
  - Expected name: `payment_trxid_unique`.
  - Expected key: `{ "payment.claims.trxIdNormalized": 1 }`.
  - Expected `unique: true` and exact partial filter:
    `{ "payment.claims.trxIdNormalized": { $type: "string" } }`.
  - Rejects sparse, collation, hidden and TTL variants.
  - Reads live `listIndexes` metadata through `db.collection('orders').indexes()`.
  - Returns a safe readiness reason; never exposes credentials.
- `server/src/config/db.ts`:
  - Disables implicit index creation in production and whenever any manual
    provider is enabled.
  - When manual providers are enabled, checks the payment index before the API
    starts and disconnects/fails startup if it is missing or wrong.
  - Keeps COD-only startup independent of the payment index.
  - Supports an `inspectPaymentIndex` test seam.
- `server/src/controllers/health.controller.ts`:
  - Adds `paymentIndex` to `/health` only when a manual provider is enabled;
    readiness is 503 when the index is missing/wrong.
  - COD-only health response remains byte-compatible (`{ ok, transactions }`).
- Runtime guards:
  - Manual order creation: `server/src/services/order.service.ts`.
  - Manual claim submission: `server/src/services/payment-claim.service.ts`.
  - Admin payment review: `server/src/services/payment-claim.service.ts`.
  - Refund completion is intentionally not blocked by the TrxID index; refunds
    must remain possible for already-received money.
  - Failures return HTTP 503 `PAYMENT_INDEX_UNAVAILABLE` without leaking index
    details.
- Every guard reads live index metadata, so a dropped index or a reconnection
  fails closed. The startup check and health check also re-inspect live state.
- No index is created or replaced by application startup. The disposable-only
  helper remains `npm run payment-index`.

### H1 tests added

- Missing index + provider enabled: startup refuses; runtime manual writes
  return 503; database connection is closed.
- Missing index + every provider disabled: startup/COD succeeds; a COD order
  still reserves stock.
- Incorrect index definition: readiness fails (unit + integration).
- Duplicate historical claims: unique index build returns `E11000`; readiness
  fails and manual writes remain blocked.
- Index inspection throws: startup fails closed (unit).
- Database reconnection with the index missing: runtime readiness fails closed.
- Concurrent cross-order duplicate TrxID: existing integration test remains
  green.
- Valid idempotent retries: existing order/proof retry tests remain green.

Files: `server/src/config/payment-index.ts`,
`server/src/config/db.ts`, `server/src/controllers/health.controller.ts`,
`server/src/services/order.service.ts`,
`server/src/services/payment-claim.service.ts`,
`server/test/payment-index-readiness.test.ts`,
`server/test/db-connect.test.ts`, `server/test/payment-unit.test.ts`.

---

## 3. H2 — Refund evidence

### Implementation

- `server/src/schemas/admin.schema.ts` now requires:
  - `refundReference` (4-100 letters/digits/dots/underscores/hyphens),
  - `refundAmount` (positive integer poisha; must equal the order total),
  - `refundRecipient` (normalized Bangladeshi mobile; must equal the sender
    wallet that paid),
  - `confirmed: true` (explicit attestation that the admin checked the actual
    provider refund record).
- `server/src/models/order.model.ts` stores durable evidence:
  - `payment.refundReference`, `payment.refundAmount`,
    `payment.refundRecipient`, `refundedBy`, `refundedAt`, `refundNote`.
  - The `verificationHistory` entry carries the same evidence and an actor
    role.
- `server/src/services/payment-claim.service.ts`:
  - Rejects missing/invalid evidence with 400.
  - Rejects amount mismatch and recipient mismatch with 400.
  - Uses a guarded one-way update (`paymentStatus: refund_pending`,
    `payment.refundedAt: null`).
  - Identical evidence retry is idempotent (200).
  - Different evidence on an already-refunded order is 409 and never
    overwrites the audit record.
  - Concurrent admins: one evidence set wins; different evidence gets 409; the
    audit trail keeps exactly one refund entry.
  - Enqueues a `payment_refunded` notification in the same transaction; delivery
    runs after commit and cannot reverse the refund.
- Admin UI:
  - Requires reference, BDT amount with 2 decimals, recipient and a checkbox
    confirming the actual provider record.
  - Client validation mirrors server rules.
  - Shows the refund evidence and audit trail; claim history includes rejected
    sender/TrxID entries.
  - Actor labels now distinguish customer/admin actions.
- Customer UI:
  - Shows refund-pending and refunded states with provider reference, amount and
    recipient.
  - Shows payment history actor labels.

### H2 tests added

- Missing reference/amount/recipient/confirmation.
- Forged amount and recipient.
- Valid completion with admin identity and timestamp.
- Identical-evidence retry and conflicting-evidence 409.
- Concurrent admins with different evidence.
- Notification dispatch failure does not reverse the completed refund and the
  outbox row remains durable.
- Client validation unit test for refund evidence.

Files: `server/src/schemas/admin.schema.ts`,
`server/src/models/order.model.ts`,
`server/src/services/payment-claim.service.ts`,
`server/src/models/notification.model.ts`,
`client/components/admin/ManualPaymentReview.tsx`,
`client/components/orders/ManualPaymentPanel.tsx`,
`client/lib/validation/payment.ts`, `client/lib/types/order.ts`,
`client/lib/types/api.ts`, `client/lib/__tests__/payment-validation.test.ts`,
`server/test/manual-payments.test.ts`.

### H2 residual limitation

The evidence is an administrator attestation plus matching stored order data,
not a provider API verification. A malicious admin can still lie; the control
now forces the admin to record the provider reference, exact amount and
recipient, and leaves a durable audit trail. This is the maximum achievable
without provider refund APIs. Partial refunds and refunds to a different
recipient are intentionally not supported and require an owner decision.

---

## 4. H3 — Branch history and integration

### Current ancestry (observed)

```text
HEAD = 2e433df (Phase 2 uncommitted)
origin/main = 2b6cc89 (merge of PR #3, includes ac3eb04)
git merge-base --is-ancestor ac3eb04 HEAD -> exit 1
HEAD..origin/main -> 4 commits
origin/main..HEAD -> 0 commits
```

The worktree lacks `ac3eb04`, including:

- `client/lib/catalog/product-selection.ts` and its tests.
- Product page / PurchasePanel imports moved out of the `'use client'` module.
- `client/components/admin/ConfirmDialog.tsx` `useId` fix.
- `client/package.json` product-selection test and `test:catalog` script.
- `client/tests/catalog.browser.mjs`.
- Admin category message and server product/category regression tests.
- `ConfirmDialog` now has two instances on a manual order page (parent cancel
  dialog and payment review dialog); without `useId` the static
  `id="confirm-title"` is duplicated.

No merge/rebase/stash/reset/clean was performed.

### Proposed integration procedure (requires separate owner approval)

1. Preserve the dirty worktree without touching it:
   - Generate a patch outside the repository:
     `git diff --binary > C:\Temp\phase2.patch`.
   - Copy the untracked Phase 2 source files listed in
     `PAYMENT_PHASE2_IMPLEMENTATION_REPORT.md` / this report to an external
     backup directory. Do not use `git stash`, `git reset`, `git checkout` or
     `git clean` on the current worktree.
2. Fetch `origin` and create a clean integration worktree from `origin/main`
   (`2b6cc89`), e.g. `C:\Temp\abstract-phase2-integration`.
3. Apply the Phase 2 patch there, then copy the untracked source files into the
   same paths.
4. Resolve only the expected overlaps:
   - `client/components/admin/ConfirmDialog.tsx`: keep the `useId` accessibility
     fix and the new `confirmVariant` prop.
   - `client/package.json`: include both `product-selection.test.ts` and
     `payment-validation.test.ts`, and retain `test:catalog`.
   - Preserve `origin/main` versions of the product page, `ProductSelection`,
     `PurchasePanel`, `product-selection.ts`, catalog browser test and
     admin-catalog message.
5. Do not overwrite or delete the product-detail tests or `catalog.browser.mjs`.
6. Run the full regression matrix in the integration worktree:
   - Server unit + database integration + new H1/H2 tests.
   - Client tests including product-selection tests.
   - Account and catalog browser suites (when Playwright is available).
   - Payment/refund browser smoke.
   - Type-check, lint, production builds and `git diff --check`.
   - Disposable index apply/status/rollback and readiness negative tests.
7. Review `git diff origin/main` and the full branch diff before any PR.
8. Merge/rebase/push only after owner approval; no force-push.

The exact package counts and browser checks must be re-established on the
integrated branch; the current worktree's results below do not replace that
integration run.

---

## 5. Medium corrections

- **Fulfilment gating:** prepaid orders cannot move to `processing`, `shipped`
  or `delivered` until `paymentStatus === 'paid'`. COD is unchanged. Admin UI
  hides those actions and shows a reason; cancellation of an unpaid pending
  order remains available. `server/src/services/admin-order.service.ts`,
  `client/components/admin/AdminOrderDetail.tsx`.
- **Notification concurrency:** outbox rows are claimed with an atomic
  `findOneAndUpdate` lease (`lockedAt`/`lockId`), processed one at a time, and
  released on failure. Concurrent dispatchers cannot double-process a row.
  `server/src/models/notification.model.ts`,
  `server/src/services/notification.service.ts`.
- **Disabled-provider instructions:** public responses return an empty
  instruction list for disabled providers. `server/src/config/payment.ts`.
- **Audit labels / rejected claims:** history entries carry
  `actor: customer | admin | system`; the admin UI shows claim history including
  rejected sender/TrxID and refund evidence. `server/src/models/order.model.ts`,
  `server/src/services/order.service.ts`,
  `client/components/admin/ManualPaymentReview.tsx`.
- **Admin action guard:** the UI no longer offers processing/shipping/delivery
  for prepaid unpaid orders, or cancellation while payment verification is
  pending. `client/components/admin/AdminOrderDetail.tsx`.
- **Tests:** added H1 startup/runtime/reconnection tests, H2 evidence/retry/
  concurrency/notification-failure tests, admin prepaid cancellation and
  processing/shipping guards, outbox concurrency, and client refund validation.

---

## 6. Verification results

### Server

```powershell
npm run type-check          # exit 0
npm run type-check:test     # exit 0
npm run lint                # exit 0
npm run build               # exit 0
$env:MONGODB_TEST_MODE='disposable'
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_corrective_full_test?replicaSet=rs0&directConnection=true'
npm test                    # 137/137 passed, 30 suites, 0 failed, exit 0
npm run test:db             # 108/108 passed, 25 suites, 0 failed, exit 0
npm run test:unit           # 47/47 passed, 7 suites, 0 failed, exit 0
```

The optional standalone topology test was not exercised because
`MONGODB_STANDALONE_URI` was not set. It was not counted as passed.

### Client

```powershell
npm run type-check          # exit 0
npm run lint                # exit 0
npm test                    # 39/39 passed, 3 suites, 0 failed
$env:NEXT_PUBLIC_SITE_URL='https://abstract-lifestyle.example'
npm run build               # exit 0
```

### Browser smoke

The local production build on port 3033, with synthetic API responses and
existing global `puppeteer-core` + cached Chromium (no dependency added):

**15/15 checks passed**:

- Checkout shows all four methods; disabled method not selectable.
- Receiving number/total shown for enabled bKash.
- No horizontal overflow at 375px.
- Proof submission moves to pending and hides receiving number.
- Admin payment panel shows sender/TrxID/actions.
- Pending payment page hides processing/shipping/cancel actions the server rejects.
- Mark Paid succeeds; 375px/1440px no overflow.
- Refund form rejects missing reference/confirmation.
- Valid refund evidence records and displays `REF-UI-1001`.
- Refund form has no horizontal overflow at 375px.

The committed Playwright suites were not run because no Playwright Node module
is installed; no dependency was added. The catalog suite also remains absent
from this worktree until H3 integration.

### Index helper / migration

```text
--apply     -> Created payment_trxid_unique (exit 0)
--status    -> expected unique partial index (exit 0)
--rollback  -> Dropped payment_trxid_unique (exit 0)
--status    -> not found (exit 0)
```

Duplicate history probe: `createIndex` failed with `E11000`; no index was left;
manual readiness returned not-ready.

### Repository hygiene

- `git diff --check`: exit 0 (line-ending warnings only).
- No dependency or lockfile change.
- No secrets or real receiving numbers added.
- No commit/push/merge/rebase/deploy.
- All disposable MongoDB/Next/API processes were stopped and temporary dbpaths
  removed.

---

## 7. Changed files in this corrective patch

### Server added

- `server/src/config/payment-index.ts`
- `server/test/payment-index-readiness.test.ts`

### Server modified

- `server/src/config/db.ts`
- `server/src/controllers/health.controller.ts`
- `server/src/models/order.model.ts`
- `server/src/models/notification.model.ts`
- `server/src/schemas/admin.schema.ts`
- `server/src/services/admin-order.service.ts`
- `server/src/services/order.service.ts`
- `server/src/services/payment-claim.service.ts`
- `server/src/services/notification.service.ts`
- `server/package.json`
- `server/test/db-connect.test.ts`
- `server/test/manual-payments.test.ts`
- `server/test/payment-unit.test.ts`

### Client modified

- `client/components/admin/AdminOrderDetail.tsx`
- `client/components/admin/ManualPaymentReview.tsx`
- `client/components/orders/ManualPaymentPanel.tsx`
- `client/lib/api/admin.ts`
- `client/lib/types/api.ts`
- `client/lib/types/order.ts`
- `client/lib/validation/payment.ts`
- `client/lib/__tests__/payment-validation.test.ts`

### Docs

- `PAYMENT_PHASE2_CORRECTIVE_REPORT.md` (new)
- `PAYMENT_PHASE2_IMPLEMENTATION_REPORT.md`
- `PAYMENT_PHASE2_REVIEW_PACKAGE.md`
- `PAYMENT_INDEX_MIGRATION_PLAN.md`
- `PAYMENT_CONFIGURATION.md`

The full Phase 2 allowlist remains in
`PAYMENT_PHASE2_IMPLEMENTATION_REPORT.md`.

---

## 8. Remaining risks and owner decisions

1. **H3 integration not executed.** The branch is four commits behind
   `origin/main`; the product-detail fix and tests are absent. Integrate only
   after owner approval.
2. **Production index not created.** `payment_trxid_unique` must be created and
   verified before enabling any provider. Production auto-index is disabled;
   all existing indexes must be migrated/verified.
3. **Refund evidence is attestation, not provider API proof.** Partial refunds
   and refunds to a different recipient require an owner decision.
4. **No committed Playwright payment/refund suite.** The 15-check puppeteer
   smoke is external evidence, not repository CI coverage.
5. **Reservation expiry is inert.** `MANUAL_PAYMENT_EXPIRY_MINUTES` does not
   cancel orders; owner policy is required.
6. **Reconciliation gaps:** money sent before submission, cancelled unpaid
   orders, and rejected-but-actually-paid claims require manual support policy.
7. **Outbox future transports:** atomic lease prevents concurrent
   double-processing; at-least-once delivery still requires transport-level
   deduplication if email/SMS is added.
8. **COD-only production startup:** auto-index is disabled in production; the
   existing Phase 0/1 indexes must be present before deploying this build.

## 9. Status

**PASS WITH CONDITIONS** — H1 and H2 are closed with tests; H3 is analysed and
has an exact integration procedure, but the integration, production index
migration and owner policy approvals remain outstanding.
