# Phase 2 implementation report — manual MFS payments

- Repository: `C:\Project\Abstract Lifestyle`
- Branch: `feature/manual-mfs-payments`
- Base: `2e433dfcaee1927165ee161980c5e5ba57468516` (approved Phase 1 commit)
- Working tree at start: only pre-existing untracked report files; no tracked
  modifications.
- No commit, push, merge, deploy, dependency addition, production database,
  production index, or live receiving-account change was made.

Note: the previous branch HEAD (`ac3eb04`, the post-Phase 1 product-detail fix)
was deliberately not used as the base because the task named `2e433df` as the
approved starting commit. The `ac3eb04` branch remains intact; nothing was lost
or rewritten.

`REQUIREMENTS.md` lists online payment as out of MVP scope. This task is the
later explicit Phase 2 authorization; manual methods remain disabled by
default so the storefront behaves as before until the owner enables them.

## 0. Corrective patch (H1-H3 and medium findings)

The independent review findings were addressed in a corrective patch; the full
delta, commands and residual risks are in
`PAYMENT_PHASE2_CORRECTIVE_REPORT.md`.

- **H1:** Live index readiness is verified at startup, health and every manual
  claim write. Missing/wrong index fails startup or returns 503; COD-only
  startup does not require it. Production implicit index creation is disabled.
- **H2:** Refund completion now requires a provider refund reference, exact
  amount, matching payer account and an explicit admin confirmation. Evidence is
  stored in the payment document and audit history; identical retries are
  idempotent, conflicting evidence is rejected, and refund notifications are
  durable.
- **H3:** Ancestry is documented; this branch is four commits behind
  `origin/main` and does not include `ac3eb04`. No merge/rebase was performed.
  The exact integration and regression procedure is in the corrective report.
- **Medium:** prepaid processing/shipping/delivery is blocked until payment is
  paid; outbox rows use an atomic lease; disabled-provider instructions are
  hidden; audit actor labels and rejected-claim history are corrected; admin
  actions the server rejects are hidden; missing tests were added.

## 1. What was implemented

### Payment architecture

- Added `manual` provider adapters for bKash, Nagad and Rocket while preserving
  the existing COD provider.
- Extended `paymentMethod` to `cod | bkash | nagad | rocket` and introduced
  one authoritative `paymentStatus`:
  `unpaid | awaiting_payment | pending_verification | paid | rejected |
  refund_pending | refunded | cancelled`.
- Kept order fulfilment (`status`) separate from payment.
- The embedded `payment` subdocument stores provider, sender number, TrxID,
  normalized TrxID, submission/review/refund metadata, claims and audit history.
- Customer requests can never set `paid`, `rejected`, `refunded` or any verified
  state.

Deviation from the suggested field list: there is deliberately no second
`payment.status`. That would duplicate the authoritative top-level
`paymentStatus`. Claim audit statuses live in `payment.claims[]`; current state
is `paymentStatus`.

### Checkout and submission

- Existing server-authoritative totals, transaction sessions, stock CAS,
  checkout claim and `checkoutId` idempotency are unchanged.
- Manual order creation records `awaiting_payment`; disabled or misconfigured
  providers are rejected before the cart claim or stock decrement.
- Customer proof submission is a second stage on `/orders/[id]`:
  `POST /api/orders/:id/payment`.
- Sender numbers use the existing Bangladeshi mobile normalization/validation.
- TrxIDs are trimmed, whitespace-stripped, uppercased and length/character
  checked with configurable bounds.
- Same-claim retries are idempotent. Different details while pending return 409
  `PAYMENT_CLAIM_LOCKED`. Resubmission is allowed only after rejection.
- All submitted claims, including rejected ones, remain in `payment.claims`.

### Receiving accounts

- Env-only configuration: `BKASH_PAYMENT_NUMBER`, `NAGAD_PAYMENT_NUMBER`,
  `ROCKET_PAYMENT_NUMBER` plus explicit `*_PAYMENT_ENABLED` flags.
- All providers default to disabled. Startup refuses an enabled provider with a
  missing/invalid receiving account.
- Rocket accepts 11-digit or 12-digit account forms; other providers use
  11-digit mobile accounts.
- `GET /api/payments/methods` returns public details only; disabled providers
  return `enabled: false` and no receiving number.
- Provider instructions are configurable with `|`-separated env overrides. The
  defaults do not claim that personal Send Money is an approved business
  collection method.

### Duplicate TrxID protection

- Partial unique multikey index `payment_trxid_unique` on
  `payment.claims.trxIdNormalized` (`unique: true`,
  `partialFilterExpression: { "payment.claims.trxIdNormalized": { $type: "string" } }`).
- Guarded atomic submission plus duplicate-key translation to HTTP 409
  `PAYMENT_TRX_ID_USED`.
- Index helper: `server/src/scripts/payment-index.ts`
  (`npm run payment-index -- --apply|--status|--rollback`). It refuses
  production and non-disposable targets.
- Index apply/status/rollback was exercised on a disposable local replica set
  (see results below). No production index was created.

### Admin verification

- Extended the existing admin orders screen with:
  - payment status and payment method filters,
  - a pending-payment queue shortcut,
  - sender number, TrxID, submission time, receiving account and authoritative
    order total,
  - Mark Paid and Reject actions guarded by the exact pending claim id,
  - mandatory rejection reason,
  - verification audit trail with admin id and timestamps,
  - manual refund completion.
- Server uses the existing admin role guard and atomic guarded updates. Two
  competing admins can produce only one decision; the other receives 409.
- A prepaid order cannot be marked delivered before payment verification.

### Customer UI

- Checkout now shows COD plus bKash/Nagad/Rocket. Disabled methods are visible
  but not selectable and never show a receiving number.
- Enabled manual methods show the exact payable total, receiving number, copy
  action and provider instructions.
- The order page collects sender number and TrxID, shows inline errors, blocks
  duplicate clicks, and displays pending/rejected/paid/refund states.
- The receiving number and send instructions are hidden once a claim is pending
  to discourage a second payment.
- My Orders shows payment status badges and recent payment notifications.
- No PIN, OTP or password is requested; the UI explicitly warns against sharing
  them.

### Cancellation, refunds, notifications

- COD cancellation is unchanged.
- Manual cancellation while `pending_verification` is blocked for both customer
  and admin (`PAYMENT_REVIEW_IN_PROGRESS`).
- Cancelling a paid prepaid order moves it to `refund_pending`, restores stock
  once, and does not mark it refunded.
- Admins can record a completed manual refund; no provider refund API is called.
- A transactional notification outbox records submitted/approved/rejected and
  refund-pending events. Delivery is in-app and runs after commit; delivery
  failures cannot reverse the payment transaction.

## 2. API additions

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/payments/methods` | public | Enabled payment options, public receiving details |
| POST | `/api/orders/:id/payment` | customer owner | Submit sender + TrxID |
| GET | `/api/notifications` | authenticated | Customer payment updates |
| PATCH | `/api/admin/orders/:id/payment` | admin | Approve/reject the exact pending claim |
| PATCH | `/api/admin/orders/:id/payment/refund` | admin | Mark manual refund complete |

Admin order listing accepts `paymentStatus` and `paymentMethod` filters in
addition to the existing search and fulfilment status.

## 3. Files changed

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

- `client/components/admin/CopyButton.tsx` moved to
  `client/components/ui/CopyButton.tsx` (now shared by customer and admin UI).

### Documentation

- `PAYMENT_CONFIGURATION.md`
- `PAYMENT_INDEX_MIGRATION_PLAN.md`
- `PAYMENT_PHASE2_IMPLEMENTATION_REPORT.md`
- `PAYMENT_PHASE2_REVIEW_PACKAGE.md`
- `PAYMENT_PHASE2_CORRECTIVE_REPORT.md` (corrective H1-H3 detail)

### Corrective delta (H1-H3 / medium)

- Server added: `server/src/config/payment-index.ts`,
  `server/test/payment-index-readiness.test.ts`.
- Server modified: `server/src/config/db.ts`,
  `server/src/controllers/health.controller.ts`,
  `server/src/models/notification.model.ts`,
  `server/src/services/notification.service.ts`,
  `server/src/services/payment-claim.service.ts`,
  `server/src/services/order.service.ts`,
  `server/src/services/admin-order.service.ts`,
  `server/src/schemas/admin.schema.ts`, `server/test/db-connect.test.ts`,
  `server/test/manual-payments.test.ts`, `server/test/payment-unit.test.ts`.
- Client modified: `client/components/admin/AdminOrderDetail.tsx`,
  `client/components/admin/ManualPaymentReview.tsx`,
  `client/components/orders/ManualPaymentPanel.tsx`,
  `client/lib/api/admin.ts`, `client/lib/types/api.ts`,
  `client/lib/types/order.ts`, `client/lib/validation/payment.ts`,
  `client/lib/__tests__/payment-validation.test.ts`.

All pre-existing untracked reports and unrelated files were preserved.

## 4. Verification results

### Server

| Command | Result |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run type-check:test` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` on disposable replica set | **137/137 passed**, 30 suites, 0 failed, exit 0 |
| `npm run test:db` on disposable replica set | **108/108 passed**, 25 suites, 0 failed, exit 0 |
| `npm run test:unit` | **47/47 passed**, 7 suites, 0 failed, exit 0 |

The full run used MongoDB 8.2.6 on disposable loopback port 27018 with a
temporary dbpath and `MONGODB_TEST_MODE=disposable`. The optional standalone
topology check was not exercised because `MONGODB_STANDALONE_URI` was not set
(the runner printed that exact notice).

New integration coverage includes: manual order creation, bKash/Nagad/Rocket
submission formats, invalid sender/TrxID, duplicate TrxID across methods,
concurrent duplicate submissions, ownership/admin authorization, concurrent
approve/reject, disabled configuration, idempotent order/proof submission,
rejected-claim resubmission, COD checkout/cancellation, stock rollback, no
duplicate stock decrement, refund/cancellation safety, notifications, the unique
index, H1 startup/runtime/reconnection index readiness, H2 refund evidence/
retry/concurrency/notification-failure, admin prepaid cancellation, blocked
processing/shipping, and outbox concurrency.

### Client

| Command | Result |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | **39/39 passed**, 3 suites, 0 failed, exit 0 |
| `npm run build` with process-only `NEXT_PUBLIC_SITE_URL` | exit 0 |
| Custom puppeteer browser smoke (15 checks) | **15/15 passed** |

The first client production build without a process override failed on the
pre-existing `lib/site-url.ts` production guard because `.env.local` contains an
`http://` site URL. The same build passed with
`NEXT_PUBLIC_SITE_URL=https://abstract-lifestyle.example` in the build process
only; no env file was edited.

Browser smoke evidence (local production build, synthetic API responses, no
database):

- All four payment methods visible at 375px; disabled Nagad not selectable.
- bKash selection shows the configured receiving number and exact total.
- Checkout and order pages have zero horizontal overflow at 375px.
- Manual order opens the proof form; submitting moves to pending verification.
- Receiving number is hidden after submission to prevent a second payment.
- Admin payment panel shows sender, TrxID and actions; pending page hides
  processing/shipping/cancel actions the server rejects.
- Mark Paid flow succeeds; refund form rejects missing reference/confirmation.
- Valid refund evidence records and displays the provider reference.
- Admin panel and refund form have zero horizontal overflow at 375px; admin also
  at 1440px.
- Screenshots retained outside the repository at
  `C:/Users/mahim/AppData/Local/Temp/opencode/p2-browser-evidence`.

The repository Playwright suite (`client/tests/account.browser.mjs`) was not run
because no Playwright Node module is currently installed; only the cached
browser binary remains. No dependency was installed. The custom puppeteer run
uses an existing global `puppeteer-core` and the cached Chromium executable.

### Index helper

| Command | Result |
|---|---|
| `npm run payment-index` without disposable mode | refused, exit 1, no index changed |
| `--apply` on disposable `p2_corrective_index_test` | created, exit 0 |
| `--status` | expected unique partial index, exit 0 |
| `--rollback` | dropped, exit 0 |
| final `--status` | not found, exit 0 |
| duplicate-history `createIndex` | `E11000`, no index left, exit 1 |

### Repository hygiene

- `git diff --check`: exit 0 (line-ending warnings only).
- `client/.env.local` was read once while inspecting the existing build
  configuration and is read automatically by Next. It was **not modified**, and
  no value from it was copied into source, documentation or this report. The
  server `.env` was not read.
- Disposable MongoDB and Next processes were stopped and temporary dbpaths
  removed.
- No test routes, harness pages, probe scripts or fixtures remain in the project.
- No commit, push, merge or deploy was performed.

## 5. Remaining owner decisions

1. Authorized receiving accounts and approved transfer type per provider.
2. Enable/disable decision for each provider and final public instructions.
3. Unpaid-order expiry policy and late-payment reconciliation ownership.
4. Refund workflow and who may mark refunds complete.
5. Whether paid prepaid orders may be cancelled by customers.
6. Whether a rejected TrxID may ever be reused (current rule: no).
7. Whether self-service resubmission after rejection is acceptable (current
   rule: yes).
8. Whether an admin correction workflow for wrong claims is required (current
   rule: no overwrite; reject and resubmit).
9. Production index timing/authorization (not performed here).
10. Whether an external notification channel (email/SMS) is required (current
    delivery is in-app only).
11. Whether partial refunds or refunds to a different recipient are required
    (current rule: full order total to the paying wallet only).
12. Whether admin refund attestation is sufficient without a provider refund
    API integration.

## 6. Conditions for PASS

- H1 and H2 are implemented and covered by the corrective tests; independent
  review is still required.
- H3 is **not** integrated: this worktree is four commits behind `origin/main`
  and lacks `ac3eb04`. Use `PAYMENT_PHASE2_CORRECTIVE_REPORT.md` for the exact
  owner-approved integration procedure and re-run the full matrix.
- Manual providers remain disabled until the owner confirms accounts.
- The production index plan must be authorized and executed separately; this
  build disables production implicit index creation.
- The repository Playwright suite should be run in the release environment.
- Owner decisions on refunds, expiry, reconciliation and notification channels
  remain.

**PASS WITH CONDITIONS**
