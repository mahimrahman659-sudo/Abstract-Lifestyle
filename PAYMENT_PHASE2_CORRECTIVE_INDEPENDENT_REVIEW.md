# Phase 2 corrective patch — independent review

- Repository: `C:\Project\Abstract Lifestyle`
- Branch: `feature/manual-mfs-payments`
- HEAD: `2e433dfcaee1927165ee161980c5e5ba57468516`
- Review date: 2026-11-19
- Mode: read-only review. No source changes, commit, push, merge, rebase, stash,
  reset, deployment, production database/index operation or real payment was
  performed. This report is the only file added by the review.
- Disposable test environment: MongoDB 8.2.6 single-node replica set on
  loopback `127.0.0.1:27018`, temporary dbpaths outside the repository, local
  Next.js production server on loopback. All processes and dbpaths were removed
  after the review.

## Verdict

**PASS WITH CONDITIONS**

H1, H2 and the medium corrections are implemented and the payment tests pass.
The code is not yet commit/deployment-ready because the branch is four commits
behind `origin/main`, the product-detail fix and its tests are absent, the
production index/migration inventory is incomplete for the new non-unique
indexes, and the owner policies/accounts are unconfirmed.

---

## 1. Findings

### Critical

None.

### High

#### H-1 — Branch integration is still a release blocker (H3 not executed)

The payment worktree is still based on `2e433df`; `ac3eb04` is not an ancestor:

```text
HEAD = 2e433df
origin/main = 2b6cc89 (merge of PR #3, includes ac3eb04)
git merge-base --is-ancestor ac3eb04 HEAD -> exit 1
HEAD..origin/main -> 4 commits
origin/main..HEAD -> 0 commits
```

Missing from this worktree:

- `client/lib/catalog/product-selection.ts` and its tests.
- `client/app/products/[slug]/page.tsx:7-9` still imports
  `pickInitialSelection` from `@/components/catalog/ProductSelection`.
- `client/components/catalog/ProductSelection.tsx:1` is a `'use client'` module
  and `:18` exports the function used by the server page.
- `client/components/catalog/PurchasePanel.tsx:15-17,73` imports it from the
  client module.
- `client/components/admin/ConfirmDialog.tsx:58,61` still uses the static
  `confirm-title` id; the `ac3eb04` `useId` fix is absent. A manual order page
  renders two `ConfirmDialog` instances, so the id is duplicated.
- `client/package.json:11-12` lacks the product-selection test and
  `test:catalog` script.
- `client/tests/catalog.browser.mjs` is absent.
- The `ac3eb04` server category/product-delete tests and admin-catalog message
  fix are absent.

This is a release-compatibility condition, not a payment-flow defect. No branch
operation was performed. The exact integration plan is in section 6.

#### H-2 — Production auto-index is disabled globally, but the migration plan does not enumerate all critical/new indexes

`server/src/config/db.ts:51-52` disables Mongoose auto-index in production (and
whenever a manual provider is enabled). That is correct for "do not silently
create production indexes", but the application startup check only verifies the
payment unique index (`server/src/config/db.ts:87-101`).

The Phase 2 schema also adds indexes that are not covered by the readiness gate:

- `server/src/models/order.model.ts:272-273` — `paymentStatus` and
  `paymentMethod` admin queue indexes.
- `server/src/models/notification.model.ts:67-68` — user timeline and outbox
  claim indexes.

A production deployment with missing Phase 0/1 unique indexes could still run
COD functionally but lose the previous unique/guarantee behavior; the new
non-unique indexes may be absent, degrading admin/outbox queries. The migration
plan mentions keeping existing indexes but does not provide the exact
inventory/check. This must be resolved before deployment with auto-index off.

Required: an explicit pre-deployment index inventory and verification for all
critical unique indexes plus the new Phase 2 non-unique indexes, or a narrow
auto-index policy that still guarantees Phase 0/1 uniqueness. No production
index was created by this review.

### Medium

#### M-1 — Public payment methods can advertise enabled manual providers while the payment index is not ready

`GET /api/payments/methods` calls the synchronous
`getPublicPaymentMethods()` (`server/src/routes/payment.routes.ts:11-12`,
`server/src/config/payment.ts:110`) without consulting
`getPaymentIndexReadiness()` (`server/src/config/payment-index.ts:143-155`).

Manual order creation, claim submission and admin review fail closed with
`PAYMENT_INDEX_UNAVAILABLE` (`server/src/services/order.service.ts:321`,
`server/src/services/payment-claim.service.ts:82,263`). If the index is dropped
or unreadable at runtime while the server is still serving, the storefront can
still display the enabled receiving number and instructions. A customer may
transfer money and then receive a 503 when creating/submitting the order.

Startup fails when a provider is enabled without the index, so this is a
runtime-drop/reconnection-window issue. It is still a financial safety gap.
Required: the public methods route should return disabled manual methods (or
503) when payment-index readiness is false, and add a test. The checkout also
shows the receiving number before order creation, which increases the exposure.

#### M-2 — Customer refund evidence is hidden when the provider is disabled

`client/components/orders/ManualPaymentPanel.tsx:156` gates the entire panel
content on `method?.enabled`. The refund-pending/refunded notices and refund
evidence are inside that block (`:230-245`). If the provider is disabled after a
refund (or after an order becomes refund-pending), the customer sees the payment
status badge and the "not available" notice, but not the refund reference,
amount, recipient or payment history. The notification list may still show the
refund message.

Required: render refund status/evidence and payment history outside the
`method?.enabled` gate, or explicitly show refund evidence for disabled
providers. Add a browser/regression check.

#### M-3 — Refund evidence is an administrator attestation, not provider-verified proof

`server/src/schemas/admin.schema.ts:41-68` requires a reference, amount,
recipient and confirmation; `server/src/services/payment-claim.service.ts:392-557`
compares the amount to the order total and the recipient to the stored sender.
This is a meaningful improvement and satisfies the recorded-evidence control,
but it is still an admin attestation: a malicious/lazy admin can enter a
plausible reference and check the box. There is no provider refund API check.

The same applies to the pre-filled amount/recipient in
`client/components/admin/ManualPaymentReview.tsx:49-52,318-398`: the admin can
leave the defaults and confirm without manually re-entering them.

This is a residual control limitation and an owner risk acceptance item, not a
code bypass. Full proof requires a provider refund API or an independent
reconciliation source.

### Low

- **L-1 — Internal refund note/admin ids are exposed in the customer DTO.**
  `server/src/services/order.service.ts:111-126` maps `verifiedBy`,
  `refundedBy`, `refundNote` and `reviewedBy` into the shared order DTO. The
  refund note is labelled internal in the admin UI; the customer API can read
  it. Consider an admin-only projection or omit `refundNote` for customers.
- **L-2 — Refund reference is arbitrary and not checked against the original
  payment TrxID or uniqueness.** `server/src/schemas/admin.schema.ts:41-58`
  allows any 4-100 character reference; `payment-claim.service.ts:396` only
  trims it. A malicious/lazy admin could use the original payment TrxID as a
  "refund reference". Amount, recipient and confirmation are still required.
- **L-3 — Index check is not atomic with the write.** The live readiness check
  before a manual write (`payment-claim.service.ts:82,263`) cannot prevent the
  index being dropped between the check and the write. The DB unique index is
  the atomic guarantee. Residual DDL/race exposure; startup/health/per-operation
  checks are defense in depth.
- **L-4 — Outbox enqueue is inside the financial transaction.**
  `payment-claim.service.ts:212,346,537` enqueues notifications in the same
  transaction as the payment/refund. Delivery failures are isolated, but an
  outbox insert failure blocks the payment/refund transition. No corruption;
  availability coupling.
- **L-5 — No committed payment/refund browser suite.** The 15-check puppeteer
  smoke is outside the repository. `client/package.json:11-12` has no payment
  browser test; the repository Playwright suite could not run because no
  Playwright Node module is installed.
- **L-6 — The proposed 24-hour expiry is not implemented.**
  `server/src/config/env.ts:77` parses `MANUAL_PAYMENT_EXPIRY_MINUTES`, but it is
  inert; awaiting-payment orders reserve stock indefinitely. The proposed
  "never auto-expire submitted claims" is also not encoded as a policy (there is
  no expiry mechanism at all). Owner approval and implementation are required.
- **L-7 — Admin UI still prefills refund amount/recipient.**
  `client/components/admin/ManualPaymentReview.tsx:50-51` initializes the amount
  and recipient from the order. The server validates them, but the UI does not
  force independent re-entry. Low process-control risk.
- **L-8 — No TrxID/sender search in the admin queue.** Existing search is order
  number/phone only (`server/src/schemas/admin.schema.ts:24-32`). Operational
  reconciliation by provider reference is harder; not a security defect.

### Verified without finding

- H1 startup, health and runtime guards fail closed for missing/wrong/unknown
  index definitions; COD-only startup works without the payment index.
- H2 refund evidence, amount/recipient matching, admin identity/timestamp,
  audit history, idempotent identical retries, conflicting evidence 409,
  concurrent admins, and dispatch-failure isolation are implemented and tested.
- Medium M1/M2/M3/M4/M6 (fulfilment gating, disabled instructions, actor labels,
  rejected-claim display, atomic outbox lease, hidden admin actions) are
  implemented and tested.
- Customers cannot set paid/refunded states; payment proof ownership and admin
  authorization are enforced.
- No configured receiving numbers are hardcoded in application source; tests
  use synthetic examples. No secrets, dependency changes or lockfile changes
  were found in the changed source.

---

## 2. H1 evidence

| Requirement | Evidence |
|---|---|
| Exact index identity | `server/src/config/payment-index.ts:5-7` (name/key/partial), `:42-118` exact evaluator |
| Reject wrong key/unique/partial/sparse/collation/hidden/TTL | `payment-index.ts:62-113` |
| Live metadata read | `payment-index.ts:124-134` (`orders.indexes()`) |
| Startup fail-closed | `server/src/config/db.ts:45,51-52,87-101`; disconnects and throws |
| Production auto-index off | `db.ts:51-52` |
| Health readiness | `server/src/controllers/health.controller.ts:24-31` |
| Manual order guard | `server/src/services/order.service.ts:321` |
| Manual submission guard | `server/src/services/payment-claim.service.ts:82` |
| Admin review guard | `server/src/services/payment-claim.service.ts:263` |
| COD-only unaffected | H1 test "does not require the payment index when every manual provider is disabled"; server test passed |
| No startup index creation | No `createIndex`/`syncIndexes` in `server/src`; only disposable helper `server/src/scripts/payment-index.ts:71` |
| Reconnection | Live-read guard; H1 reconnection test passed |
| Duplicate TrxIDs | Unique index + precheck + duplicate-key translation; concurrent cross-order test passed |

Residual: the check is not atomic with the write (L-3). The public methods
display gap is M-1.

---

## 3. H2 evidence

| Requirement | Evidence |
|---|---|
| Mandatory reference | `server/src/schemas/admin.schema.ts:41-59`; service `payment-claim.service.ts:396` |
| Amount/recipient verification | `admin.schema.ts:60-68`; service `:433-443,477-481` |
| Actual-refund confirmation | `confirmed: true` schema + UI checkbox `ManualPaymentReview.tsx:365-369` |
| Admin identity/time | `payment-claim.service.ts:492-510,537-543`; model `order.model.ts:219-221` |
| Durable audit | `order.model.ts:37-47,187-202`; history display `ManualPaymentReview.tsx:457-466` |
| Guarded/idempotent | `payment-claim.service.ts:366-384,485-535`; identical retry test passed |
| Concurrent admins | H2 test "lets only one competing admin complete a refund with different evidence" passed |
| Customer cannot self-refund | Admin route protected by `server/src/routes/admin.routes.ts:46,94-98`; H2 tests |
| Notification failure | Refund remains refunded when dispatch is mocked to fail; notification row remains; test passed |
| Client validation | `client/lib/validation/payment.ts` refund validation; client test passed |

Residual: attestation vs provider proof (M-3); internal note/admin ids (L-1);
reference arbitrary/non-unique (L-2); outbox enqueue coupling (L-4).

---

## 4. Medium findings evidence

- **M1 prepaid fulfilment gate:** `server/src/services/admin-order.service.ts:101-111`
  blocks processing/shipped/delivered for non-COD unless `paid`; cancellation
  remains separately guarded at `:113-128`. UI filter
  `client/components/admin/AdminOrderDetail.tsx:145-151,283-299`. Tests
  "blocks processing and shipping..." and "blocks delivering..." passed.
- **M2 disabled instructions:** `server/src/config/payment.ts:129` returns `[]`
  when disabled. Unit test passed.
- **M3 audit actor/claims:** actor written in all new history paths; rejected
  claims shown in `ManualPaymentReview.tsx:421-447`; actor label at `:457`.
  Test asserts submitted actor `customer`, approved actor `admin`.
- **M4 outbox lease:** `server/src/services/notification.service.ts:68-120`
  atomic `findOneAndUpdate` lease; success/failure updates clear lock. Test
  "processes outbox rows idempotently under concurrent dispatchers" passed.
- **M6 admin actions:** `AdminOrderDetail.tsx:147-151,283-299` hides
  processing/shipping/delivery and pending-review cancellation; browser smoke
  confirmed.
- **Missing tests:** refund evidence/retry/concurrency/failure, index
  readiness/reconnection/duplicates, outbox concurrency, prepaid cancellation,
  processing/shipping gate, and client refund validation are present.

---

## 5. Branch reconciliation

### Current ancestry

```text
HEAD                          2e433df
origin/main                   2b6cc89
ac3eb04 ancestor of HEAD?     no (exit 1)
HEAD..origin/main             4 commits
origin/main..HEAD             0 commits
```

Missing commits: `2b6cc89` (merge PR #3), `ac3eb04` (product-detail/admin
delete), `e715b4b` (merge PR #2), `a888e9e` (merge PR #1). The branch has no
unique committed work; all Phase 2 changes are uncommitted.

### Overlap / conflict assessment

- `client/components/admin/ConfirmDialog.tsx`: Phase 2 adds `confirmVariant`;
  `ac3eb04` adds `useId` and removes the static id. Both must be combined.
- `client/package.json`: Phase 2 adds `payment-validation.test.ts`; `ac3eb04`
  adds `product-selection.test.ts` and `test:catalog`. Combine all.
- Product-detail files (`client/app/products/[slug]/page.tsx`,
  `ProductSelection.tsx`, `PurchasePanel.tsx`,
  `client/lib/catalog/product-selection.ts`, `client/tests/catalog.browser.mjs`)
  are not modified by Phase 2 but are absent/old here. Preserve `origin/main`
  versions; never overwrite them with the old branch.
- `server/test/order-integrity.test.ts`, `server/src/services/admin-catalog.service.ts`
  and category/product tests from `ac3eb04` must be retained.
- No commit/rebase/stash/reset/clean was performed.

### Recommended safe integration

1. Do not touch the dirty worktree. Create an external backup:
   `git diff --binary > C:\Temp\phase2.patch`; copy all untracked Phase 2
   source/docs files to an external directory. Do not stash/reset/checkout/clean.
2. `git fetch origin`; create a clean worktree from `origin/main` (`2b6cc89`)
   outside the repository.
3. Apply the Phase 2 patch to the integration worktree, then copy the untracked
   Phase 2 files into their paths.
4. Resolve only `ConfirmDialog.tsx` and `client/package.json` by combining both
   sides as above. Preserve `origin/main` product/catalog/admin-catalog files
   and tests.
5. Run the full matrix in the integration worktree:
   - Server full tests (including H1/H2, order integrity, index readiness).
   - Client tests including product-selection.
   - Account/catalog Playwright suites when Playwright is available.
   - Payment/refund browser smoke.
   - Type-check, lint, builds, `git diff --check`, secret/dependency scan.
   - Disposable index apply/status/rollback and readiness negative tests.
6. Review `git diff origin/main` and the full branch diff, then commit/PR only
   after owner approval. No force-push.

---

## 6. Test results

Environment: Windows PowerShell, Node 24.15.0, disposable MongoDB 8.2.6
single-node replica set on loopback port 27018, temporary dbpath outside the
repository. No production database, credentials or financial transaction used.

### Server

```powershell
npm run type-check          # exit 0
npm run type-check:test     # exit 0
npm run lint                # exit 0
npm run build               # exit 0
$env:MONGODB_TEST_MODE='disposable'
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_corrective_review_test?replicaSet=rs0&directConnection=true'
npm test                    # 137/137 passed, 30 suites, 0 failed, exit 0
```

The optional standalone-topology test was **not exercised** because
`MONGODB_STANDALONE_URI` was not set. The runner printed the skip notice; it is
not counted as a pass. No other tests failed or were skipped.

The full `npm test` run includes the H1 index-readiness suite, H2 refund
suite, order-integrity suite, manual payments, payment unit tests and database
guards.

### Client

```powershell
npm run type-check          # exit 0
npm run lint                # exit 0
npm test                    # 39/39 passed, 3 suites, 0 failed
$env:NEXT_PUBLIC_SITE_URL='https://abstract-lifestyle.example'
npm run build               # exit 0
```

### Browser

The local production build on port 3033 with synthetic API responses and the
existing global `puppeteer-core` + cached Chromium:

**15/15 checks passed**:

- Checkout shows all four methods; disabled method not selectable.
- Receiving number/total shown for enabled bKash.
- 375px checkout/order/refund layout has zero horizontal overflow.
- Proof submission moves to pending and hides the receiving number.
- Admin pending page hides processing/shipping/cancel actions the server
  rejects.
- Admin review shows sender/TrxID/actions; Mark Paid succeeds.
- Refund form rejects missing reference/confirmation; valid evidence records and
  displays `REF-UI-1001`.
- Admin 1440px has zero horizontal overflow.

The committed Playwright suites were not run because no Playwright Node module
is installed; no dependency was added. The catalog suite is absent until H3
integration. The 15-check puppeteer harness is outside the repository and is
not CI coverage.

### Index helper

```text
--apply     -> Created payment_trxid_unique (exit 0)
--status    -> exact unique partial index (exit 0)
--rollback  -> Dropped payment_trxid_unique (exit 0)
--status    -> not found (exit 0)
```

### Repository / security checks

- `git diff --check`: exit 0 (line-ending warnings only).
- Secret scan of changed/untracked source: **0 hits** for cloud keys, private
  keys, JWT secrets or `mongodb+srv` URIs. Application source contains no
  hardcoded `*_PAYMENT_NUMBER` value; tests use synthetic numbers.
- No `.env` or lockfile changes; only `server/.env.example` is modified.
- `git diff -- server/package.json client/package.json` contains test/script
  changes only; no dependency additions.
- No commit, push, merge, rebase or deployment.
- No lingering MongoDB/Next/API process; temporary dbpaths removed.
- Worktree at review start: 69 status entries (31 modified, 1 deleted,
  37 untracked); this report is the only new path added by the review.

---

## 7. Proposed commit allowlist

### Implementation — modified (31)

`client/app/checkout/page.tsx`,
`client/components/admin/AdminOrderDetail.tsx`,
`client/components/admin/AdminOrders.tsx`,
`client/components/admin/ConfirmDialog.tsx`,
`client/components/checkout/CheckoutClient.tsx`,
`client/components/orders/OrderDetailClient.tsx`,
`client/components/orders/OrdersHistory.tsx`,
`client/config/site.ts`,
`client/lib/api/admin.ts`, `client/lib/api/order.ts`,
`client/lib/types/api.ts`, `client/lib/types/order.ts`,
`client/package.json`,
`server/.env.example`, `server/package.json`,
`server/src/config/db.ts`, `server/src/config/env.ts`,
`server/src/controllers/admin.controller.ts`,
`server/src/controllers/health.controller.ts`,
`server/src/controllers/order.controller.ts`,
`server/src/models/order.model.ts`,
`server/src/routes/admin.routes.ts`, `server/src/routes/index.ts`,
`server/src/routes/order.routes.ts`,
`server/src/schemas/admin.schema.ts`, `server/src/schemas/order.schema.ts`,
`server/src/services/admin-order.service.ts`,
`server/src/services/order.service.ts`,
`server/src/services/payment.service.ts`,
`server/test/README.md`, `server/test/db-connect.test.ts`.

### Implementation — deleted/moved (1)

`client/components/admin/CopyButton.tsx` (moved to
`client/components/ui/CopyButton.tsx`).

### Implementation — new (25)

- Docs: `PAYMENT_CONFIGURATION.md`, `PAYMENT_INDEX_MIGRATION_PLAN.md`,
  `PAYMENT_PHASE2_CORRECTIVE_REPORT.md`,
  `PAYMENT_PHASE2_IMPLEMENTATION_REPORT.md`,
  `PAYMENT_PHASE2_REVIEW_PACKAGE.md`.
- Client: `client/components/admin/ManualPaymentReview.tsx`,
  `client/components/checkout/PaymentMethodSelector.tsx`,
  `client/components/orders/ManualPaymentPanel.tsx`,
  `client/components/orders/PaymentStatusBadge.tsx`,
  `client/components/ui/CopyButton.tsx`,
  `client/lib/__tests__/payment-validation.test.ts`,
  `client/lib/api/payment.ts`, `client/lib/validation/payment.ts`.
- Server: `server/src/config/payment-index.ts`,
  `server/src/config/payment.ts`,
  `server/src/models/notification.model.ts`,
  `server/src/routes/notification.routes.ts`,
  `server/src/routes/payment.routes.ts`,
  `server/src/scripts/payment-index.ts`,
  `server/src/services/notification.service.ts`,
  `server/src/services/payment-claim.service.ts`,
  `server/src/utils/payment.ts`,
  `server/test/manual-payments.test.ts`,
  `server/test/payment-index-readiness.test.ts`,
  `server/test/payment-unit.test.ts`.

### Excluded from the implementation commit

- Pre-existing untracked reports: `AGENTS.md`, `AUDIT_*`, `REVIEW_*`,
  `PRODUCT_DETAIL_DELETE_FIX_REPORT.md`,
  `RELEASE_READINESS_PRODUCT_DELETE.md`.
- Historical review artifacts: `PAYMENT_PHASE2_INDEPENDENT_REVIEW.md` and this
  report. Preserve them in the worktree; commit separately only if the owner
  wants review documents in history.
- `.env`, `.env.local`, lockfiles or generated/build artifacts.

The allowlist must be extended with the `ac3eb04` product-detail/catalog files
when the branch is integrated.

---

## 8. Commit and deployment readiness

- **Commit:** Not yet a release/integration commit. The worktree is internally
  consistent and tests pass, but the branch is four commits behind
  `origin/main`, has no unique commits, and lacks the product-detail fix and
  tests. Commit only after owner approval and preferably after H3 integration;
  a feature-branch checkpoint commit, if approved, must be followed by an
  integration commit and full regression.
- **Merge/PR:** Not ready. Resolve H-1/M-1/H-2 conditions and re-run the
  integrated matrix first.
- **Deployment:** Not ready. Providers remain disabled; no production index or
  receiving-account configuration exists; no production migration was executed;
  owner refund/expiry/cancellation policies are unapproved; the committed
  browser suite is missing.
- **Provider activation:** Not ready. Receiving-account eligibility and
  permitted transfer types are unconfirmed; do not enable bKash/Nagad/Rocket.
- **Production index:** Not created or modified. The disposable apply/status/
  rollback passed; production requires explicit owner authorization and the
  migration plan, including the index inventory finding H-2.

---

## 9. Remaining owner decisions

1. **24-hour expiry** proposed default is **not implemented**:
   `MANUAL_PAYMENT_EXPIRY_MINUTES` is inert; stock reservation has no expiry.
   Implementing it requires an owner-approved release/reconciliation policy.
2. **Never auto-expire submitted claims:** no expiry mechanism exists, so this
   is compatible in behavior but not encoded as policy. Confirm and implement
   before adding any expiry worker.
3. **Rejected-claim resubmission with a new TrxID:** implemented. Old TrxIDs
   remain reserved; reuse of a rejected TrxID is blocked. Same order retry is
   idempotent only for the current pending claim.
4. **Recorded evidence for every manual refund:** implemented as an admin
   attestation with reference, exact amount, payer recipient and confirmation.
   Not provider-API verified.
5. **Receiving-account eligibility and permitted transfer type** for bKash,
   Nagad and Rocket remain unconfirmed; keep providers disabled.
6. **Partial refunds or refunds to a different recipient:** not supported; full
   order total to the payer wallet only.
7. **Paid prepaid cancellation:** current rule allows pending/processing
   cancellation into `refund_pending`; confirm this is the desired policy.
8. **Admin attestation sufficiency:** whether a recorded reference/amount/
   recipient/checkbox is sufficient without provider refund API integration.
9. **Notification channel:** in-app only; email/SMS would need deduplication and
   a worker.
10. **Production index authorization and migration window**, including the
    complete index inventory.
11. **H3 integration approval** and the final commit/PR scope.

---

## 10. Limitations

- No production MongoDB, Atlas, provider API, live refund or real payment was
  used.
- The repository Playwright suite was unavailable; the 15-check puppeteer smoke
  is local evidence, not committed CI coverage.
- The optional standalone-topology test was not exercised.
- The review did not change source code; only this report was added.
- No commit, push, merge, rebase or deployment was performed.

**PASS WITH CONDITIONS** — not approved for deployment, provider activation or
a release commit until H-1, H-2, M-1 and the owner decisions are resolved and
the integrated branch passes the full regression matrix.
