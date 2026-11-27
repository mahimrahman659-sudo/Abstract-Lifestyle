# Phase 2 independent review — manual bKash, Nagad and Rocket payments

- Repository: `C:\Project\Abstract Lifestyle`
- Branch reviewed: `feature/manual-mfs-payments`
- Branch HEAD: `2e433dfcaee1927165ee161980c5e5ba57468516`
- Worktree: Phase 2 changes are **uncommitted** (62 status entries: 27 modified,
  1 deleted, 34 untracked, including pre-existing reports and this review)
- Review date: 2026-11-19
- Mode: read-only. No source change, staging, commit, push, merge, deployment,
  production database access or real financial transaction was made. The only
  source-tree file added is this report; test/build commands regenerated
  ignored build artifacts only.
- Disposable evidence: local MongoDB 8.2.6 single-node replica set on
  `127.0.0.1:27018` with temporary dbpaths outside the repository; a local
  Next.js production server on loopback; all processes and dbpaths removed after
  the review.

## Verdict

**PASS WITH CONDITIONS**

The core payment authorization, state separation, ownership, idempotency,
concurrency guards, COD preservation and transaction rollback behavior are
sound and are backed by passing tests. The implementation is **not approved for
production** until the High findings below are closed and the branch is
reconciled with current `origin/main`.

---

## 1. Findings

### Critical

None.

### High

#### H1 — Manual payments are not fail-closed on the TrxID unique index

The database-level cross-order TrxID guarantee exists only if
`payment_trxid_unique` is present. The application never verifies that at
startup or before accepting a manual claim.

Evidence:

- The index is declared at `server/src/models/order.model.ts:263-269`.
- `server/src/config/db.ts:38` connects with plain `mongoose.connect(uri)`;
  Mongoose `autoIndex` is not disabled or awaited.
- `server/src/index.ts:48-52` starts the HTTP listener immediately after
  `connectDB()`; it does not wait for model indexes.
- `server/src/services/payment.service.ts:79-86` enables a manual provider
  solely from env configuration, with no index check.
- `server/src/services/payment-claim.service.ts:107-116` and `:138-147`
  perform application pre-checks, but those reads cannot prevent a concurrent
  cross-order race if the unique index is absent.
- The index helper refuses production (`server/src/scripts/payment-index.ts:29-35`),
  so production relies on manual migration or Mongoose auto-index behavior.

Executed evidence:

1. Clean disposable DB, API started with `BKASH_PAYMENT_ENABLED=true`:
   the API answered `/health` with 200 and Mongoose auto-created
   `payment_trxid_unique` within a few seconds. The index creation is
   asynchronous; there is a serving window before it completes.
2. Disposable DB pre-loaded with two orders sharing normalized TrxID `DUP123`:
   the API still started with `BKASH_PAYMENT_ENABLED=true` and answered
   `/health` with 200. After more than 10 seconds the payment index was still
   missing, no startup failure occurred, and no index error was visible in the
   app log.
3. Running `npm run payment-index -- --apply` against the duplicate DB failed
   with MongoDB `E11000` and left no `payment_trxid_unique` index.

Impact: if providers are enabled while the index is missing (failed migration,
duplicate legacy data, auto-index failure, or the asynchronous build window),
two different orders can accept the same TrxID concurrently. The same external
transfer could then be claimed against two orders and presented to an admin.

Required fix: before accepting manual payments, verify the exact index exists
with `unique: true` and the expected partial filter. Fail startup (or fail
manual methods closed) if it is missing or different. Decide and document
`autoIndex` for production; do not rely on asynchronous auto-index creation.
Add a test that starts the API with a missing/wrong index and a manual provider
enabled.

#### H2 — Refund completion requires no evidence of an actual refund

`completeManualRefund` marks a prepaid order `refunded` with an optional free
text note. No provider refund reference, amount, receipt or second confirmation
is required.

Evidence:

- `server/src/schemas/admin.schema.ts:41-43` — `note` is optional.
- `server/src/services/payment-claim.service.ts:359-384` — any admin can call
  it; `:369` sets `refunded`; `:372` stores `input.note ?? null`; `:374-380`
  records the same optional note.
- `client/components/admin/ManualPaymentReview.tsx:265-275` — the UI explicitly
  labels the refund reference/note “optional” and submits without one.

The state transition itself is one-way and protected by the
`paymentStatus: 'refund_pending'` filter at
`server/src/services/payment-claim.service.ts:366`, so a retry cannot mark a
second refund. That does not satisfy the requirement that refund completion
requires evidence of an actual refund.

Impact: a mistaken or unauthorized refund completion can make the order appear
refunded with no provider transaction reference, amount or receipt to audit.

Required fix: require a non-empty provider refund reference/transaction ID
(and, if the owner requires, refund amount/date), validate it, store it in a
dedicated field, show it in the audit trail, and reject empty submissions in
both API and UI. Add a refund retry/evidence test.

#### H3 — Branch is based on an older commit and does not include the product-detail fix

`origin/main` is now `2b6cc89` (merge of PR #3, including `ac3eb04`).
`ac3eb04` is **not** an ancestor of this branch:

```text
git merge-base --is-ancestor ac3eb04 HEAD  -> exit 1
git rev-list --count HEAD..origin/main      -> 4
git rev-list --count origin/main..HEAD      -> 0 (all Phase 2 work is uncommitted)
```

The reviewed worktree still has the pre-fix product-detail code:

- `client/app/products/[slug]/page.tsx:6-9` imports `pickInitialSelection`
  from `@/components/catalog/ProductSelection`.
- `client/components/catalog/ProductSelection.tsx:1` is a `'use client'` module;
  `:18` defines `pickInitialSelection`.
- `client/components/catalog/PurchasePanel.tsx:15-17` and `:73` do the same.
- `client/lib/catalog/product-selection.ts`,
  `client/lib/__tests__/product-selection.test.ts` and
  `client/tests/catalog.browser.mjs` are absent on this branch.
- `client/components/admin/ConfirmDialog.tsx:58,61` lacks the `useId`-based
  unique `aria-labelledby` fix from `ac3eb04`.
- `client/package.json:11-12` lacks the `product-selection` test and
  `test:catalog` script.
- `server/test/order-integrity.test.ts` lacks the product-delete/category
  regression cases added by `ac3eb04`.

Impact: the product-detail fix and its coverage are not present in the worktree
under review; a release branch built from it is not equivalent to current main.
`ConfirmDialog.tsx` and `client/package.json` are touched by both lines of work
and are likely merge/rebase conflicts. On a manual order page both
`AdminOrderDetail` and `ManualPaymentReview` render a `ConfirmDialog`; the static
`id="confirm-title"` is duplicated in the DOM, so the missing `useId` fix is an
actual accessibility defect on the payment review screen.

Required fix: rebase or merge the Phase 2 work onto `origin/main` (`2b6cc89`),
resolve `ConfirmDialog`/`package.json`, preserve both the payment and
product-detail test suites, and re-run the full server/client/browser matrix.

### Medium

#### M1 — Prepaid orders can be moved to processing/shipped before payment is verified

Only `delivered` is gated on payment. `pending -> processing` and
`processing -> shipped` are allowed for a manual order whose payment is
`awaiting_payment` or `rejected`.

Evidence:

- `server/src/services/admin-order.service.ts:12-18` allowed transitions.
- `server/src/services/admin-order.service.ts:101-111` blocks only
  `target === 'delivered'` when payment is not `paid`.
- `client/components/admin/AdminOrderDetail.tsx:33-41` offers
  “Mark as processing” and “Mark as shipped” for those states.
- `client/config/site.ts:98` tells customers “We verify the payment against our
  receiving account before dispatch.”

Impact: an admin can dispatch goods before funds are verified; once shipped, the
existing order rules no longer allow cancellation. The customer-facing promise
is stronger than the server behavior.

Required decision/fix: gate processing/shipped on `paymentStatus === 'paid'`
for prepaid orders, or explicitly accept and document the risk and add an admin
warning. Add tests for the chosen policy.

#### M2 — Disabled provider instructions are still returned publicly

`getPublicPaymentMethods` nulls the receiving number for disabled providers but
returns the configured instructions unchanged.

Evidence:

- `server/src/config/payment.ts:124-127` — `receivingNumber` is gated, then
  `instructions: config.instructions` is returned regardless of `enabled`.
- `server/src/routes/payment.routes.ts:11-12` — the endpoint is public.

Impact: if an operator includes a receiving number, internal contact or other
sensitive detail in `*_PAYMENT_INSTRUCTIONS`, it remains publicly readable after
the provider is disabled. The default instructions do not contain a number, but
the override path does not enforce that.

Required fix: return no provider-specific instructions (or only a generic
“not available” message) for disabled providers. Add a test asserting disabled
responses contain no provider-specific text/number.

#### M3 — Admin audit UI mislabels customer actions and hides rejected claim details

The audit trail labels every actor as `admin`, including `submitted` and
customer `cancelled` entries, and the UI never displays the rejected claim's
sender/TrxID even though it is stored.

Evidence:

- `client/components/admin/ManualPaymentReview.tsx:60-62` selects only the
  latest pending claim.
- `client/components/admin/ManualPaymentReview.tsx:165-187` shows sender/TrxID
  only for that pending claim.
- `client/components/admin/ManualPaymentReview.tsx:294-306` renders history
  actions; `:303` appends `admin ${entry.by}` for every entry.
- `server/src/services/order.service.ts:117-122` maps history without actor
  role and without sender/trx.
- `server/src/models/order.model.ts:161-210` does store the claims and history.

Impact: misleading audit attribution and difficult reconciliation of rejected
claims. A reviewer cannot tell from the UI that a submission/cancellation was
made by the customer, nor inspect the rejected TrxID that must remain
auditable.

Required fix: include actor role/identity (or omit the “admin” label for
customer actions), show the claims history including rejected sender/TrxID, and
keep refund evidence in the same audit view.

#### M4 — Notification outbox is not concurrency-safe/idempotent for multiple dispatchers, and enqueue failures can block payment decisions

`dispatchPendingNotifications` reads pending rows and saves them without an
atomic claim/lease. Two concurrent dispatchers can process the same row. The
current in-app channel has no external duplicate side effect, but the outbox is
documented as the base for email/SMS. `deliverNotifications` is fire-and-forget
and no scheduled retry worker is present.

Evidence:

- `server/src/services/notification.service.ts:57-96` — find pending rows, then
  per-row `notification.save()`.
- `server/src/services/notification.service.ts:100-102` — fire-and-forget.
- `server/src/services/notification.service.ts:64-88` — no claim/lease or
  idempotency key.
- `server/src/services/payment-claim.service.ts:208-217` and `:332-340` — the
  outbox insert is inside the payment transaction.
- `server/src/services/admin-order.service.ts:172-183` and
  `server/src/services/order.service.ts:599-609` — refund-pending outbox
  inserts are also transactional.

Impact: future external transports can double-send; an outbox insert failure
rolls back the payment submission/review, so a notification persistence problem
can block a payment decision. Delivery failure after commit is correctly
isolated.

Required fix: claim each row atomically (findOneAndUpdate lease or equivalent),
add an idempotency key per event, add a scheduled retry worker, and decide
whether outbox enqueue failure may block the financial transition. Add
concurrency/failure tests.

#### M5 — Missing committed tests for refund evidence/retry, missing index, outbox failure, admin cancellation of prepaid orders and committed payment browser flows

Evidence:

- `server/test/manual-payments.test.ts:634-664` completes a refund once; there
  is no refund retry test and no evidence requirement test.
- No test starts the API with the index missing/wrong.
- No test injects an outbox insert/delivery failure during a payment decision.
- The paid-cancellation test uses the customer `cancelOrder` path; the admin
  cancellation path for a paid manual order is not exercised.
- `client/package.json:11-12` has no committed payment browser test. The
  11-check puppeteer smoke used during implementation/review lives outside the
  repository.
- The repository Playwright suite could not run because no Playwright Node
  module is installed; only a cached Chromium binary is present.

Impact: the highest-risk controls and the most important UI flows are not
regression-protected. The implementation report's browser evidence is not
repeatable in this checkout.

Required fix: add the missing server tests and a committed payment browser
suite (or a committed deterministic API/browser harness) covering checkout,
proof submission, pending/rejected states, admin approve/reject/refund, disabled
providers and mobile overflow.

#### M6 — Admin UI exposes actions that the server will reject during payment review

`AdminOrderDetail` still shows “Cancel order” for pending/processing manual
orders, including `pending_verification`, and shows “Mark as shipped” while
payment is unpaid. The server correctly rejects cancellation during review and
delivery while unpaid, but the UI does not disable or explain these actions
before the click.

Evidence:

- `client/components/admin/AdminOrderDetail.tsx:33-41` — cancel/ship actions.
- `server/src/services/admin-order.service.ts:101-128` — delivery and pending
  verification guards return 409.

Impact: avoidable admin errors and confusing error notices. This is not a
security bypass because the server guards the state.

Required fix: disable/hide these actions with a reason when
`paymentStatus === 'pending_verification'` or when a prepaid order is unpaid.

### Low

- **L1 — Inert expiry configuration.** `MANUAL_PAYMENT_EXPIRY_MINUTES` is
  parsed at `server/src/config/env.ts:77` and documented as inert, but nothing
  reads it. Abandoned manual orders reserve stock indefinitely. Remove it until a
  policy exists, or add an explicit owner-approved reconciliation job.
- **L2 — Admin identifiers/refund note exposed in customer DTO.**  
  `server/src/services/order.service.ts:102-122` exposes `verifiedBy`,
  `reviewedBy`, `by` and `refundNote` in the shared order DTO. The customer UI
  does not display most of these, but the API returns them. Consider an
  admin-only projection.
- **L3 — Admin refund double-click race.**  
  `client/components/admin/ManualPaymentReview.tsx:108-131` has no synchronous
  in-flight ref. Two fast clicks can produce one success and one 409; the state
  remains correct but the UI may show an error after success.
- **L4 — No TrxID or sender search.**  
  `server/src/schemas/admin.schema.ts:24-32` and
  `server/src/services/admin-order.service.ts:20-39` support order
  number/phone + method + payment status only. An admin holding a provider
  statement cannot search by TrxID/sender directly; this is an operational gap.
- **L5 — TrxID character set is not configurable.**  
  `server/src/utils/payment.ts:53-61` and the schema in
  `server/src/schemas/order.schema.ts` enforce A-Z0-9; only length is
  configurable. Confirm provider formats before release; a valid reference
  containing `-` or `_` would be rejected before a claim can be created.
- **L6 — Refund completion does not notify the customer.**  
  `server/src/services/payment-claim.service.ts:359-394` records the refund but
  does not enqueue a customer notification.
- **L7 — No refresh/polling of the pending queue.** The admin must refresh to
  see new claims. Acceptable for the current volume; document the workflow.
- **L8 — Receiving number is visible before order creation.** The checkout
  selector shows the enabled receiving number and instructions before the order
  is validated/reserved (`client/components/checkout/PaymentMethodSelector.tsx`).
  The copy tells the customer to submit after placing the order, and section 7
  asked for checkout display, but a customer can still send before stock/order
  validation. Consider a “place the order first” gate or a stronger warning.

### Informational — verified behavior

- The unique multikey index blocks duplicates **across documents**, but MongoDB
  allows duplicate array elements **within one document**. The probe inserted
  `XYZ789` twice in one document and later pushed `ABC123` again into the same
  document successfully; cross-document inserts of those values failed with
  `E11000`. Current application paths prevent this through the pre-check at
  `server/src/services/payment-claim.service.ts:107-116,138-147` and the
  guarded one-way update at `:151-193`. The index alone is not an
  intra-document guarantee; this must be understood in future code changes.
- The partial filter `{ 'payment.claims.trxIdNormalized': { $type: 'string' } }`
  correctly excludes legacy orders, `payment: {}`, and empty claim arrays.
- Client-supplied unknown fields are stripped, not assigned. Executed probes:
  `createOrderSchema` with `paymentStatus:'paid'` and `total:1` returned only
  the allowed fields; `manualPaymentSubmissionSchema` with
  `paymentStatus/status/verifiedAt` returned only sender/TrxID.
- The server computes order totals from DB prices and stock; the order create
  input has no amount field (`server/src/services/order.service.ts:355-357,381-395`).
- No real receiving numbers are hardcoded. Test numbers are synthetic. Defaults
  are disabled (`server/src/config/env.ts:60-77`).
- No PIN/OTP/password field exists; the UI explicitly warns not to share them.
- The request logger logs method, path only (no query), status, latency and user
  id; it never logs bodies/cookies/headers
  (`server/src/middleware/request-logger.ts`).
- Payment error messages do not echo sender/TrxID. The duplicate-key path is
  converted to a safe 409 (`server/src/services/payment-claim.service.ts`).
- COD checkout, cancellation, delivery marking and stock restoration remain
  green in the existing suite. Manual stock reservation is a single CAS
  decrement and is restored once.
- Payment approval does not change order fulfilment status; the review update
  only sets payment fields and the claim decision.

---

## 2. Concurrency and security verification evidence

| Check | Evidence | Result |
|---|---|---|
| Customer cannot mark paid | No customer write route for payment status; only `reviewManualPayment` and COD delivery set `paid` (`payment-claim.service.ts:285-323`, `admin-order.service.ts:144-146`) | Pass |
| Admin authorization | `server/src/routes/admin.routes.ts:46` applies `requireAuth, requireRole('admin')` before payment/refund routes at `:89-98` | Pass |
| Customer ownership | `loadOwnedOrder` filters `{ _id, user }` (`payment-claim.service.ts:41-52`); HTTP ownership test | Pass |
| Duplicate TrxID across orders/providers | Application test passed; cross-doc unique index probe returned `E11000` | Pass |
| Concurrent cross-order duplicate | Integration test passed | Pass |
| Concurrent same-order claim | Guarded update; integration test passed | Pass |
| Intra-document duplicate | MongoDB allows it; app pre-check + guarded update prevent it; no current path found | Pass with residual risk |
| Retry idempotency | Order `checkoutId` replay and exact-claim replay tests pass | Pass |
| Failed transaction rollback | Order insert failure test passes; payment/review/refund writes are atomic per transaction | Pass |
| Client amount override | Order schemas strip unknown fields; totals computed server-side | Pass |
| Rejected references auditable | Claims array retains rejected claims; API returns them; UI hides them (M3) | Partial |
| COD unchanged | Existing COD tests + manual suite COD tests pass | Pass |
| Approval vs fulfilment | Review function does not change order status | Pass |
| Competing admin decisions | One 200 + one 409 in integration test | Pass |
| Paid cancellation | Customer path sets `refund_pending`, restores stock, notification tested | Pass |
| Refund evidence | Optional note only | Fail (H2) |
| Refund retry | One-way filter prevents second `refunded`; no test | Pass by inspection, untested |
| Audit history overwrite by customer | No customer route mutates order/payment/claims; resubmission appends, never overwrites old claims | Pass |
| Index fail-closed | App serves with index absent and provider enabled | Fail (H1) |
| Disabled providers | Defaults false; unit + integration tests | Pass |
| Hardcoded numbers | Search of source/tests/docs shows synthetic placeholders only | Pass |
| Account formats | Unit tests cover 11-digit bKash/Nagad, 11/12-digit Rocket, +880 normalization | Pass |
| PIN/OTP/password | No input fields; instructions warn | Pass |
| Public config leakage | Receiving number gated; disabled instructions not gated | Partial (M2) |
| Notification rollback isolation | Delivery runs after commit and is caught; enqueue is transactional | Partial (M4) |
| Outbox idempotency | No per-row claim/lease | Fail (M4) |
| Sensitive logs/errors | Request logger path only; payment errors generic | Pass |

---

## 3. Tests and commands executed

### Environment

- Windows PowerShell 5.1, Node 24.15.0.
- Disposable MongoDB 8.2.6 single-node replica set `rs0` on
  `127.0.0.1:27018`, temporary dbpath outside the repo.
- No production database, credentials or financial transaction used.

### Server

```powershell
npm run type-check          # exit 0
npm run type-check:test     # exit 0
npm run lint                # exit 0
npm run build               # exit 0
$env:MONGODB_TEST_MODE='disposable'
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_review_test?replicaSet=rs0&directConnection=true'
npm test                    # 118/118 passed, 28 suites, 0 failed, exit 0
```

The optional standalone-topology check was not exercised because
`MONGODB_STANDALONE_URI` was not set; the runner printed that exact notice.

### Client

```powershell
npm run type-check          # exit 0
npm run lint                # exit 0
npm test                    # 38/38 passed, 3 suites, 0 failed, exit 0
$env:NEXT_PUBLIC_SITE_URL='https://abstract-lifestyle.example'
npm run build               # exit 0
```

The client build reads the existing `.env.local`; no `.env` file was modified.

### Browser smoke

A local production build on `127.0.0.1:3033` with synthetic API responses
(existing global `puppeteer-core` + cached Chromium; no dependency added):

**11/11 checks passed**:

- All four payment methods visible at 375px; disabled Nagad not selectable.
- bKash selection shows receiving number and exact total.
- Checkout has no horizontal overflow at 375px.
- Manual order opens proof submission.
- Receiving number hidden after submission to prevent a second payment.
- Order payment panel has no horizontal overflow at 375px.
- Admin panel shows sender/TrxID/actions.
- Admin panel has no horizontal overflow at 375px or 1440px.
- Mark Paid flow succeeds.

The committed `client/tests/account.browser.mjs` suite was **not run** because
no Playwright Node module is installed; no dependency was added. The committed
`client/tests/catalog.browser.mjs` is absent on this branch (H3).

### Index/migration probes

```powershell
npm run payment-index -- --apply     # created payment_trxid_unique, exit 0
npm run payment-index -- --status    # expected unique partial index, exit 0
npm run payment-index -- --rollback  # dropped, exit 0
npm run payment-index -- --status    # not found, exit 0
```

Duplicate-data preflight on `p2_review_dupes_test`:

```text
createIndex with two docs sharing DUP123 -> E11000, exit 1
index after failure -> only _id
```

API startup with missing index + provider enabled:

```text
clean DB:      /health 200; payment_trxid_unique auto-created after a few seconds
duplicate DB:  /health 200; payment_trxid_unique still missing after >10s
```

### Repository hygiene

```powershell
git diff --check    # exit 0 (line-ending warnings only)
git status          # 62 entries; the only path added by the review is this report
```

No source file was modified by this review. The disposable MongoDB and local
Next/API processes were stopped and their temporary directories removed.

---

## 4. Ancestry and release compatibility

```text
HEAD = 2e433df
origin/main = 2b6cc89 (merge of PR #3, includes ac3eb04)
git merge-base --is-ancestor ac3eb04 HEAD -> exit 1
HEAD..origin/main -> 4 commits
origin/main..HEAD -> 0 commits
```

Consequences:

- The Phase 2 worktree does not contain `ac3eb04`; the product-detail fix and
  its product-selection/catalog tests are missing.
- `ConfirmDialog.tsx` and `client/package.json` overlap with `ac3eb04`; expect
  rebase/merge conflicts. `ConfirmDialog` currently lacks the `useId` fix.
- A normal merge into `origin/main` may preserve untouched files, but this
  worktree as-is is not release-equivalent and cannot be validated against the
  current main behavior.
- The implementation report's statement that `ac3eb04` “remains intact” is true
  only on its own branch; it is not part of this review branch.

Required: rebase/merge onto `2b6cc89`, preserve both the payment and
product-detail test suites, resolve conflicts, and re-run all checks.

---

## 5. Required fixes (ordered)

1. **H1 — index fail-closed.** Disable implicit production auto-index behavior
   or explicitly wait for/verify the exact `payment_trxid_unique` definition
   before enabling manual methods. Fail closed on missing/wrong index. Add a
   startup/readiness test.
2. **H2 — refund evidence.** Require and store a provider refund reference
   (and amount/date if the owner requires), enforce it in schema/service/UI,
   and test retries and empty submissions.
3. **H3 — rebase onto `origin/main` (`2b6cc89`).** Re-run server, client,
   product/catalog and payment browser tests after conflict resolution.
4. **M1 — shipping policy.** Gate `processing`/`shipped` on verified payment,
   or obtain explicit owner acceptance and add an admin warning/test.
5. **M2 — disabled-provider instructions.** Do not return configured
   instructions for disabled providers.
6. **M3 — audit accuracy.** Add actor role/name; show rejected claim
   sender/TrxID and refund evidence in the admin audit view.
7. **M4 — outbox concurrency/retry.** Atomically claim rows, add an
   idempotency key, add a scheduled retry worker, and decide whether outbox
   insert failure may block a payment transition.
8. **M5 — tests.** Add refund evidence/retry, missing-index, outbox failure,
   admin paid cancellation, and a committed payment browser suite.
9. **M6 — admin UI guards.** Disable/hide cancel/ship actions when the server
   will reject them.
10. **Low items.** Resolve L1-L7 or record them as accepted risks.

---

## 6. Commit-ready file allowlist

The following are the intended Phase 2 worktree changes. Pre-existing untracked
reports listed at the start of the implementation are not part of this allowlist.

### Server modified

- `server/.env.example`
- `server/package.json`
- `server/src/config/env.ts`
- `server/src/controllers/admin.controller.ts`
- `server/src/controllers/order.controller.ts`
- `server/src/models/order.model.ts`
- `server/src/routes/admin.routes.ts`
- `server/src/routes/index.ts`
- `server/src/routes/order.routes.ts`
- `server/src/schemas/admin.schema.ts`
- `server/src/schemas/order.schema.ts`
- `server/src/services/admin-order.service.ts`
- `server/src/services/order.service.ts`
- `server/src/services/payment.service.ts`

### Server added

- `server/src/config/payment.ts`
- `server/src/models/notification.model.ts`
- `server/src/routes/notification.routes.ts`
- `server/src/routes/payment.routes.ts`
- `server/src/scripts/payment-index.ts`
- `server/src/services/notification.service.ts`
- `server/src/services/payment-claim.service.ts`
- `server/src/utils/payment.ts`
- `server/test/manual-payments.test.ts`
- `server/test/payment-unit.test.ts`

### Client modified

- `client/app/checkout/page.tsx`
- `client/components/admin/AdminOrderDetail.tsx`
- `client/components/admin/AdminOrders.tsx`
- `client/components/admin/ConfirmDialog.tsx`
- `client/components/checkout/CheckoutClient.tsx`
- `client/components/orders/OrderDetailClient.tsx`
- `client/components/orders/OrdersHistory.tsx`
- `client/config/site.ts`
- `client/lib/api/admin.ts`
- `client/lib/api/order.ts`
- `client/lib/types/api.ts`
- `client/lib/types/order.ts`
- `client/package.json`

### Client added

- `client/components/admin/ManualPaymentReview.tsx`
- `client/components/checkout/PaymentMethodSelector.tsx`
- `client/components/orders/ManualPaymentPanel.tsx`
- `client/components/orders/PaymentStatusBadge.tsx`
- `client/components/ui/CopyButton.tsx`
- `client/lib/__tests__/payment-validation.test.ts`
- `client/lib/api/payment.ts`
- `client/lib/validation/payment.ts`

### Client deleted/moved

- `client/components/admin/CopyButton.tsx` (moved to
  `client/components/ui/CopyButton.tsx`)

### Documentation

- `PAYMENT_CONFIGURATION.md`
- `PAYMENT_INDEX_MIGRATION_PLAN.md`
- `PAYMENT_PHASE2_IMPLEMENTATION_REPORT.md`
- `PAYMENT_PHASE2_REVIEW_PACKAGE.md`
- `PAYMENT_PHASE2_INDEPENDENT_REVIEW.md` (this report)

Before commit, resolve H3 so the allowlist also preserves the product-detail
fix and its tests from `origin/main`.

---

## 7. Unresolved owner policy decisions

1. Authorized receiving accounts and approved transfer type per provider
   (Send Money vs Merchant/Payment/other).
2. Per-provider enable/disable decision and final public instructions.
3. Whether prepaid orders may progress to processing/shipped before payment
   verification.
4. Unpaid-order expiry policy, duration, stock release and late-payment
   reconciliation ownership.
5. Refund process, required evidence/reference fields, refund authority and
   customer communication.
6. Whether customers may self-cancel paid prepaid orders or must contact
   support.
7. Whether a rejected TrxID may ever be reused (current rule: no).
8. Whether self-service resubmission after rejection is acceptable (current
   rule: yes).
9. Whether an admin correction workflow for a wrong claim is required (current
   rule: no overwrite; reject and resubmit).
10. Reconciliation for “rejected but actually paid” and
    “money sent, then order cancelled before submission” cases.
11. Notification channel (in-app only vs email/SMS) and retry/SLA expectations.
12. Production index authorization and deployment window.
13. Whether admin IDs/refund notes should be hidden from the customer DTO.

---

## 8. Production migration and rollout risks

1. **Index readiness is not enforced.** The API can serve manual orders with the
   unique index missing. Auto-index creation is asynchronous; duplicate-data
   failure is silent from the API's perspective. This is the top rollout risk.
2. **Mongoose auto-index vs explicit migration.** The app currently lets
   Mongoose create indexes on startup. The migration plan assumes an explicit
   index step. Production should disable auto-index or explicitly wait/verify;
   otherwise index builds run during serving and failures are easy to miss.
3. **Duplicate production data.** The plan's duplicate pre-check is manual. A
   failed unique build leaves no index; providers must remain disabled until it
   is resolved.
4. **Index build cost.** Unique multikey partial index on `orders` can be
   expensive on a large collection; use an Atlas low-traffic window and monitor.
5. **Rollback.** The helper drops only the index and refuses production. A
   production rollback must be manual and must disable all manual providers
   first; otherwise the duplicate guarantee is removed from live claims.
6. **Disabled-provider instructions.** Public instructions can outlive the
   enabled flag (M2).
7. **Shipping before payment.** Admin workflow can dispatch prepaid goods before
   verification (M1).
8. **Refund evidence.** Refund completion can be recorded without a provider
   reference (H2).
9. **Reconciliation gaps.** Abandoned awaiting orders, money sent before
   submission, and rejected-but-paid claims have no automated reconciliation.
10. **Branch divergence.** Release from this worktree without rebasing misses
    the product-detail fix and its tests (H3).
11. **Test repeatability.** The payment browser checks are outside the repo; the
    Playwright browser suite cannot run in this environment.

Recommended production sequence after fixes:

1. Rebase/merge onto `origin/main` and resolve conflicts.
2. Keep all manual providers disabled.
3. Disable/wait for production auto-index policy; create/verify the exact index.
4. Run duplicate pre-check and a backup.
5. Deploy with providers disabled; verify `/health`, index and logs.
6. Enable one provider only after owner confirmation of account/instructions.
7. Monitor `PAYMENT_TRX_ID_USED`, index health, pending queue and refunds.
8. Do not enable a second provider until the first provider's reconciliation is
   proven.

---

## 9. Limitations

- The review is limited to the worktree and branch state described above; the
  Phase 2 work is uncommitted.
- No production data, live provider API, Atlas index build, real refund or real
  payment was used.
- The repository Playwright suite was unavailable; a custom puppeteer smoke
  covered the main payment UI paths but is not committed.
- No assistive-technology or full WCAG audit was performed; mobile overflow was
  checked at 375px and admin at 1440px.
- MongoDB index probes used a disposable single-node replica set, not Atlas.

**PASS WITH CONDITIONS — not approved for production until H1, H2, H3 and the
required fixes are closed and independently re-tested.**
