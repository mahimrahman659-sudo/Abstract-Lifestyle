# Manual MFS payment configuration (Phase 2)

Manual bKash, Nagad and Rocket payments are **disabled by default**. Nothing in
this document authorizes a live receiving account. Enable a provider only after
the owner has confirmed an authorized business receiving account and the
approved transfer type.

## 1. Environment variables

All variables live in `server/.env` (never committed). `server/.env.example`
contains placeholders only.

| Variable | Default | Meaning |
|---|---|---|
| `BKASH_PAYMENT_ENABLED` | `false` | Explicit opt-in for bKash. Only the literal `true` enables it. |
| `BKASH_PAYMENT_NUMBER` | empty | Authorized bKash receiving account. |
| `BKASH_PAYMENT_INSTRUCTIONS` | empty | Optional instructions separated by `\|`. Empty uses safe defaults. |
| `NAGAD_PAYMENT_ENABLED` | `false` | Same for Nagad. |
| `NAGAD_PAYMENT_NUMBER` | empty | Authorized Nagad receiving account. |
| `NAGAD_PAYMENT_INSTRUCTIONS` | empty | Optional instructions separated by `\|`. |
| `ROCKET_PAYMENT_ENABLED` | `false` | Same for Rocket. |
| `ROCKET_PAYMENT_NUMBER` | empty | Authorized Rocket account (11-digit mobile or 12-digit account form). |
| `ROCKET_PAYMENT_INSTRUCTIONS` | empty | Optional instructions separated by `\|`. |
| `MFS_TRX_ID_MIN_LENGTH` | `6` | Minimum normalized TrxID length. |
| `MFS_TRX_ID_MAX_LENGTH` | `32` | Maximum normalized TrxID length. |
| `MANUAL_PAYMENT_EXPIRY_MINUTES` | `0` | Inert placeholder. `0` means no expiry policy. Nothing cancels orders today. |

### Receiving-account formats

- bKash/Nagad: 11-digit Bangladeshi mobile account (`01[3-9]XXXXXXXX`).
- Rocket: 11-digit mobile form **or** 12-digit account form (the 12th check
  digit is accepted). Rocket numbers are never forced into the 11-digit form.
- `+880`/`880` prefixes and spaces/dashes are normalized for validation.
- If a provider is enabled with a missing or invalid receiving number, the API
  refuses to start. A provider that is not enabled stays out of checkout.
- If any manual provider is enabled and the payment TrxID index is missing or
  wrong, the API refuses to start. Production implicit index creation is
  disabled; the index must be created before enabling a provider. `/health`
  reports `paymentIndex` and returns 503 while the index is not ready. Manual
  claim writes return 503 `PAYMENT_INDEX_UNAVAILABLE`; refund completion stays
  available so already-received money can be returned. COD-only startup does
  not require the payment index.

### Provider enable/disable

- `GET /api/payments/methods` is public and returns all four methods.
- Disabled methods return `enabled: false` and `receivingNumber: null`.
- Only enabled methods can create orders or accept payment submissions.
- Disabling a provider does not mutate existing orders. Existing claims remain
  reviewable; customers are told to contact support instead of sending money.

## 2. Payment lifecycle

The order has one authoritative `paymentStatus`:

```
unpaid                  COD initial state
awaiting_payment        manual order created, money not submitted yet
pending_verification    customer submitted sender number + TrxID
paid                    admin verified the received funds
rejected                admin could not verify the claim
refund_pending          a paid order was cancelled; manual refund owed
refunded                admin recorded the manual refund as complete
cancelled               manual order cancelled before payment
```

Fulfilment (`order.status`) is separate: pending -> processing -> shipped ->
delivered / cancelled. A prepaid order cannot be marked delivered unless its
payment status is `paid`.

Every order-level payment claim is also stored in `payment.claims` with its own
audit status (`pending_verification`, `approved`, `rejected`). This is history,
not a second current state: `paymentStatus` is the single authority. The
suggested `payment.status` field is intentionally not duplicated.

## 3. Two-stage checkout flow

1. Customer chooses COD or an enabled manual method at checkout.
2. The server validates the method, claims the cart, runs the existing stock
   CAS decrements and creates the order with `awaiting_payment`.
3. The customer sends the exact server-authoritative total externally.
4. On `/orders/[id]`, the customer submits:
   - sender wallet number (validated Bangladeshi mobile), and
   - transaction ID (trimmed, whitespace removed, uppercased, length checked).
5. The server moves the order to `pending_verification` and writes a
   notification outbox row in the same transaction.
6. An admin verifies the actual received funds and marks the claim paid or
   rejected. The customer can resubmit only after an explicit rejection.

The customer never sets `paid`, `rejected`, `refunded` or any verified state.

## 4. Transaction-reference uniqueness

- Normalization: trim, remove whitespace, uppercase.
- Allowed characters: `A-Z0-9`; length is configured by the two env bounds.
- Rejected claims remain in `payment.claims`, so their TrxID stays consumed.
- A partial unique multikey index (`payment_trxid_unique`) on
  `payment.claims.trxIdNormalized` prevents reuse across orders and methods.
- Duplicate claims return HTTP 409 `PAYMENT_TRX_ID_USED` with an actionable
  message.
- Exact retries of the same pending claim are idempotent; different details are
  rejected with `PAYMENT_CLAIM_LOCKED`.
- Concurrent submissions are serialized by the guarded order update and the
  unique index.
- The application verifies the live index metadata (name, key, unique, partial
  filter; rejects sparse/collation/hidden/TTL) at startup, health and before
  manual claim writes. It never creates the index at startup.
- MongoDB permits duplicate array elements within one order document; the
  application pre-check and guarded state transition prevent that path. Any
  future claim-writing code must keep both guards.

See `PAYMENT_INDEX_MIGRATION_PLAN.md` before creating the index anywhere.

## 5. Cancellation and refunds

- COD cancellation behavior is unchanged. Payment status is not rewritten.
- A manual order with `pending_verification` cannot be cancelled by the customer
  or admin until the claim is resolved. This avoids silently cancelling a
  submitted claim without reconciliation.
- A paid manual order that is cancelled moves to `refund_pending`. It is **not**
  treated as refunded.
- `PATCH /api/admin/orders/:id/payment/refund` requires:
  - the actual provider refund reference,
  - the exact refund amount (must equal the order total),
  - the customer receiving account (must match the wallet that paid),
  - explicit confirmation that the admin checked the actual provider refund
    record.
  It stores the evidence, admin identity and timestamp in durable history; no
  provider refund API is called. Identical retries are idempotent; different
  evidence is rejected with 409. Partial refunds and refunds to a different
  recipient are not supported without an owner decision.
- A cancelled manual order that was never paid moves to `cancelled`.
- Prepaid orders cannot move to `processing`, `shipped` or `delivered` until
  payment is verified; COD is unchanged.

## 6. Admin verification

The existing admin order dashboard now includes:

- a pending-payment queue (payment status filter),
- payment method and payment status filters,
- sender number, TrxID, submission time, configured receiving account,
- the authoritative order total,
- guarded Mark Paid / Reject actions,
- a mandatory rejection reason,
- verification history with actor (customer/admin/system), admin id and
  timestamps,
- rejected claim history including sender number and TrxID,
- a manual refund completion action with mandatory provider reference, amount,
  recipient and confirmation.

Mandatory checks before marking paid:

1. Recipient matches the authorized receiving account statement.
2. Amount equals the order's server-stored total.
3. Sender number matches the provider statement.
4. TrxID matches the provider statement.
5. A valid-looking TrxID alone is never sufficient.

The review update requires the exact pending claim id and the
`pending_verification` state. Two competing admins get one success and one 409.

## 7. Notifications

A transactional outbox (`Notification` collection) is written in the same
database transaction as:

- payment submitted,
- payment approved,
- payment rejected,
- cancellation of a paid order (refund pending).

Delivery currently targets the in-app notification list
(`GET /api/notifications`, shown on My Orders). Rows are claimed with an atomic
lease so concurrent dispatchers cannot process the same notification twice.
Delivery runs after commit and never reverses a committed payment transition.
Pending/attempt/retry fields are ready for a future email/SMS transport; no
external channel is configured. A future transport must deduplicate at-least-once
retries.

## 8. Expiry and reconciliation

No automatic reservation expiry or release exists. `MANUAL_PAYMENT_EXPIRY_MINUTES`
is intentionally inert until the owner approves a policy. Any future job must:

- never cancel a `pending_verification` claim without reconciliation,
- record an auditable reason and operator,
- release stock exactly once,
- use the existing guarded atomic stock restoration.

## 9. Required owner decisions

1. Authorized receiving accounts per provider and approved transfer type
   (Send Money, Merchant, Payment, etc.).
2. Whether each provider is enabled, and the exact public instructions.
3. Whether an unpaid-order expiry policy is wanted, its duration, and who
   reconciles claims that arrive late.
4. Refund process and who is authorized to mark refunds complete.
5. Whether customers may cancel paid prepaid orders or must contact support.
6. Whether a rejected claim may ever reuse the same TrxID (current rule: no).
7. Whether resubmission after rejection stays self-service (current rule: yes).
8. Whether admin correction of a mistakenly submitted claim is required
   (current rule: no overwrite; resolve by rejection and resubmission).
9. Whether partial refunds or refunds to a different recipient are required
   (current rule: full order total to the paying wallet only).
10. Whether the admin refund attestation is sufficient without a provider refund
    API integration.

## 10. Example (placeholders only)

```dotenv
BKASH_PAYMENT_ENABLED=false
BKASH_PAYMENT_NUMBER=
BKASH_PAYMENT_INSTRUCTIONS=
NAGAD_PAYMENT_ENABLED=false
NAGAD_PAYMENT_NUMBER=
ROCKET_PAYMENT_ENABLED=false
ROCKET_PAYMENT_NUMBER=
MFS_TRX_ID_MIN_LENGTH=6
MFS_TRX_ID_MAX_LENGTH=32
MANUAL_PAYMENT_EXPIRY_MINUTES=0
```
