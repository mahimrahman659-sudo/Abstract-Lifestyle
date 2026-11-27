# Phase 2 review package — manual MFS payments

Status: **PASS WITH CONDITIONS**. H1 (index readiness) and H2 (refund evidence)
are implemented and tested. H3 (branch integration) is analysed but **not**
executed. Owner approval is required before any branch operation, provider
enablement or production index creation.

## 1. Start here

1. Read `PAYMENT_PHASE2_CORRECTIVE_REPORT.md` for H1/H2/H3 changes and exact test evidence.
2. Read `PAYMENT_CONFIGURATION.md` for the state model and owner decisions.
3. Read `PAYMENT_INDEX_MIGRATION_PLAN.md` before touching any index.
3. Review the critical server paths:
   - `server/src/models/order.model.ts` — authoritative `paymentStatus`,
     `payment.claims`, partial unique index.
   - `server/src/services/payment-claim.service.ts` — submission, review,
     refund, concurrent-decision guards.
   - `server/src/services/order.service.ts` — order creation and cancellation
     payment rules.
   - `server/src/services/admin-order.service.ts` — payment-aware transitions,
     delivery guard, refund notification.
   - `server/src/config/payment.ts`, `server/src/config/env.ts`,
     `server/src/utils/payment.ts` — provider config, validation, normalization.
   - `server/src/config/payment-index.ts`, `server/src/config/db.ts`,
     `server/src/controllers/health.controller.ts` — H1 index readiness and
     production auto-index policy.
   - `server/src/services/notification.service.ts` — outbox/delivery isolation.
4. Review the UI:
   - `client/components/checkout/PaymentMethodSelector.tsx`
   - `client/components/orders/ManualPaymentPanel.tsx`
   - `client/components/admin/ManualPaymentReview.tsx`
   - `client/components/admin/AdminOrders.tsx`

## 2. Key invariants to verify

- `paymentStatus` is the only current payment state. `payment.claims[].status`
  is audit history, never a competing current state.
- Customers cannot set verified states.
- Disabled/misconfigured providers cannot create orders or accept claims.
- Any enabled manual provider requires the exact `payment_trxid_unique` index
  at startup, health and every manual claim write; missing/wrong fails closed.
  COD-only startup does not require it.
- Refund completion requires a provider reference, exact order total, matching
  payer account and explicit admin confirmation; evidence is durable and
  idempotent only for identical retries.
- Prepaid orders cannot progress to processing/shipped/delivered before paid.
- Outbox rows are atomically leased; concurrent dispatchers cannot double-process
  a row.
- Disabled-provider instructions are not returned publicly.
- A manual order reserves stock once; cart/checkout claims and totals are
  unchanged from Phase 0/1.
- Same-claim retries are idempotent; different claims while pending are locked.
- TrxID uniqueness covers rejected claims and all methods via one partial
  multikey unique index.
- Concurrent submissions and competing admin decisions produce one winner.
- `pending_verification` cancellation is blocked, not silently performed.
- A cancelled paid order is `refund_pending`, never automatically `refunded`.
- A prepaid order cannot move to processing, shipped or delivered while unpaid.
- COD checkout, cancellation, delivery marking and stock restore are unchanged.
- Notification delivery is after commit and cannot reverse payment state.
- No PIN/OTP/password is requested anywhere.

## 3. Diff summary

- Server: 14 modified, 10 added (including 2 tests and the index helper), plus
  the corrective H1/H2 delta: `config/payment-index.ts`,
  `test/payment-index-readiness.test.ts`, `config/db.ts`, health controller,
  notification model/service, refund model/schema/service, migration tests.
- Client: 13 modified, 8 added, 1 moved from admin to shared UI, plus corrective
  refund UI/validation/type/test changes.
- Docs: 5 added (this package, implementation report, configuration, index plan,
  corrective report).
- No dependencies added.
- Existing untracked reports preserved.

## 4. Test evidence

Environment: Windows PowerShell, Node 24.15.0, MongoDB 8.2.6 disposable
single-node replica set on loopback port 27018, temporary dbpath outside the
repository.

```powershell
# Server
npm run type-check          # exit 0
npm run type-check:test     # exit 0
npm run lint                # exit 0
npm run build               # exit 0
$env:MONGODB_TEST_MODE='disposable'
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_corrective_full_test?replicaSet=rs0&directConnection=true'
npm test                    # 137/137 passed, 30 suites, 0 failed
npm run test:db             # 108/108 passed, 25 suites, 0 failed
npm run test:unit           # 47/47 passed, 7 suites, 0 failed

# Client
npm run type-check          # exit 0
npm run lint                # exit 0
npm test                    # 39/39 passed, 3 suites, 0 failed
$env:NEXT_PUBLIC_SITE_URL='https://abstract-lifestyle.example'
npm run build               # exit 0
```

Browser smoke: **15/15** checks passed against the local production build with
synthetic API responses (checkout methods/disabled method, receiving
number/copy/total, proof submission, pending state, admin review, refund form
validation and evidence recording, 375px/1440px overflow). The repository
Playwright file was not run because no Playwright Node module is installed; no
dependency was added. The catalog browser suite remains absent until H3
integration.

Index helper on the disposable target:

```text
--apply     -> Created payment_trxid_unique (exit 0)
--status    -> expected unique partial index (exit 0)
--rollback  -> Dropped payment_trxid_unique (exit 0)
--status    -> not found (exit 0)
```

The helper refuses a non-disposable target and production.

## 5. Requirement checklist

| Requirement | Status |
|---|---|
| COD preserved | Yes; existing COD cancellation/delivery tests pass |
| Manual bKash/Nagad/Rocket | Yes, disabled by default |
| Extensible provider abstraction | Yes; COD + manual adapters |
| Single payment state | Yes; top-level `paymentStatus` |
| Separate fulfilment lifecycle | Yes |
| Two-stage safe checkout | Yes; proof after order/stock reservation |
| Receiving accounts via env only | Yes; no numbers in source |
| Per-provider enable/disable | Yes; default disabled/invalid config refused |
| Public details only | Yes; disabled providers expose no number |
| Sender/TrxID validation | Yes; Rocket 12-digit receiving form supported |
| Unique normalized TrxID | Yes; partial unique multikey index |
| Index readiness | Yes; startup/health/runtime fail-closed, COD-only unaffected |
| Production auto-index | Disabled; explicit migration required |
| Refund evidence | Required reference, exact amount, payer recipient, admin confirmation |
| Refund idempotency | Identical evidence only; conflicting evidence 409 |
| Prepaid fulfilment gate | Processing/shipped/delivered require `paid` |
| Outbox concurrency | Atomic lease; concurrent dispatcher test |
| Disabled instructions | Not returned publicly |
| 409 duplicate handling | Yes; `PAYMENT_TRX_ID_USED` |
| Idempotent retries | Yes; order + exact claim |
| Admin pending queue | Yes; status/method filters + shortcut |
| Search/filter | Yes; order number/phone + method + payment status |
| Mark Paid / Reject | Yes; guarded, reason required |
| Audit trail | Yes; claims + verification history with actor/admin id/time, rejected claim display |
| Customer pending/rejection UI | Yes |
| Copy receiving number/total/instructions | Yes |
| No PIN/OTP/password | Yes |
| COD cancellation unchanged | Yes |
| No auto-refund on cancel | Yes; `refund_pending` |
| Notifications | In-app outbox; delivery isolated from commit; concurrent dispatch leased |
| Automated tests | Yes; unit + DB integration + custom browser smoke |
| Existing coverage reduced | No |
| Dependencies added | No |
| Commit/push/deploy | No |
| Providers disabled by default | Yes |

## 6. Conditions

1. Owner must confirm authorized receiving accounts and receive type before any
   provider is enabled.
2. Production index creation is **not** authorized or performed here; follow
   `PAYMENT_INDEX_MIGRATION_PLAN.md` with explicit owner approval.
3. Run the repository Playwright suite in the release environment.
4. Review and accept the documented owner decisions (expiry, refunds,
   resubmission, correction workflow, notification channel).
5. H3: integrate onto `origin/main` (`2b6cc89`) using the exact procedure in
   `PAYMENT_PHASE2_CORRECTIVE_REPORT.md`; no merge/rebase was performed here.
   Re-run the full matrix after resolving `ConfirmDialog`/`package.json`.
6. Independent reviewer sign-off is required.

## 7. Explicit non-goals / not changed

- No automated gateway, refund API, SMS/email transport, reservation expiry job,
  admin claim-editing workflow, or production configuration.
- No changes to Phase 0 checkout totals, cart claim/version logic, stock CAS,
  order snapshots, httpOnly auth, or open-redirect protections.
- No changes to the existing untracked reports or unrelated worktrees.
