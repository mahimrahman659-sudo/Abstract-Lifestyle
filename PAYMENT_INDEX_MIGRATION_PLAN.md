# Manual-payment TrxID index: migration and rollback plan

## 1. Index

```js
db.orders.createIndex(
  { "payment.claims.trxIdNormalized": 1 },
  {
    name: "payment_trxid_unique",
    unique: true,
    partialFilterExpression: {
      "payment.claims.trxIdNormalized": { $type: "string" }
    }
  }
)
```

Why this shape:

- `payment.claims` is an array, so the index is multikey.
- `$type: "string"` excludes COD/legacy orders that have no claim and no
  payment subdocument.
- Rejected claims stay in the array, so their TrxID remains reserved.
- Uniqueness is global across orders and across bKash/Nagad/Rocket.

Mongoose declares the same index in `server/src/models/order.model.ts`.
`OrderModel.syncIndexes()` is a test/bootstrap helper only; it must not be run
against production.

## 1.1 Application readiness gate (corrective H1)

The application now verifies this exact index before accepting manual payments:

- `server/src/config/payment-index.ts` reads live `listIndexes` metadata and
  requires the exact name, key, `unique: true`, partial filter, and rejects
  sparse/collation/hidden/TTL variants.
- `server/src/config/db.ts` fails startup when any manual provider is enabled
  and the index is missing or wrong. It disconnects and does not publish
  readiness.
- When every manual provider is disabled, the payment index is not required and
  COD startup is unchanged.
- Production implicit index creation (`autoIndex`) is disabled. It is also
  disabled in every environment whenever a manual provider is enabled, so the
  API cannot silently create or replace the payment index at startup.
- `/health` reports `paymentIndex: false` and HTTP 503 when a manual provider is
  enabled and the index is not ready. The COD-only health payload is unchanged.
- Manual order creation, claim submission and admin payment review re-check live
  index metadata before writing and return 503
  `PAYMENT_INDEX_UNAVAILABLE` on failure. A dropped index or reconnection fails
  closed. Refund completion is intentionally not gated so already-received money
  can still be refunded.

Consequence: creating the index is a **pre-deployment migration**, not an
application-startup side effect. The disposable helper is for verification
only; production uses the explicit command below.

## 1.2 Complete critical index inventory

All of these indexes must exist before deploying with production `autoIndex`
disabled. `npm run index-inventory -- --status` verifies the exact key,
uniqueness, sparse/partial options and text weights against a disposable
database. The production equivalent must be a read-only `getIndexes()` check.

| Collection | Index name | Key | Options |
|---|---|---|---|
| carts | `user_1` | `{user:1}` | unique |
| categories | `slug_1` | `{slug:1}` | unique |
| categories | `parent_1_sortOrder_1` | `{parent:1, sortOrder:1}` | — |
| notifications | `user_1_createdAt_-1` | `{user:1, createdAt:-1}` | — |
| notifications | `status_1_availableAt_1` | `{status:1, availableAt:1}` | — |
| orders | `orderNumber_1` | `{orderNumber:1}` | unique |
| orders | `checkoutId_1` | `{checkoutId:1}` | unique, sparse |
| orders | `user_1_createdAt_-1` | `{user:1, createdAt:-1}` | — |
| orders | `status_1_createdAt_-1` | `{status:1, createdAt:-1}` | — |
| orders | `shippingAddress.phone_1_createdAt_-1__id_-1` | `{shippingAddress.phone:1, createdAt:-1, _id:-1}` | — |
| orders | `shippingAddress.phone_1_status_1_createdAt_-1__id_-1` | `{shippingAddress.phone:1, status:1, createdAt:-1, _id:-1}` | — |
| orders | `paymentStatus_1_createdAt_-1` | `{paymentStatus:1, createdAt:-1}` | — |
| orders | `paymentMethod_1_createdAt_-1` | `{paymentMethod:1, createdAt:-1}` | — |
| orders | `payment_trxid_unique` | `{payment.claims.trxIdNormalized:1}` | unique, partial `$type:"string"` |
| products | `slug_1` | `{slug:1}` | unique |
| products | `status_1_category_1` | `{status:1, category:1}` | — |
| products | `name_text_description_text` | text index | weights `name:1, description:1` |
| siteimages | `key_1` | `{key:1}` | unique |
| users | `email_1` | `{email:1}` | unique |
| users | `googleId_1` | `{googleId:1}` | unique, sparse |
| variants | `product_1` | `{product:1}` | — |
| variants | `sku_1` | `{sku:1}` | unique |
| variants | `product_1_size_1_color_1` | `{product:1, size:1, color:1}` | unique |

The inventory tool computes these expectations from the Mongoose schemas and
compares them with the live collection metadata. It treats a functionally
identical non-payment index with a different name as a warning; the
`payment_trxid_unique` name is mandatory because the H1 readiness gate requires
it. It reports extras but does not drop them.

```powershell
$env:MONGODB_TEST_MODE='disposable'
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_index_test?replicaSet=rs0&directConnection=true'
npm run index-inventory -- --status
npm run index-inventory -- --inventory
```

The application startup gate currently enforces the payment unique index
specifically. A missing order/checkout/cart/user/variant unique index would not
stop startup, so the pre-deployment inventory check is mandatory for the
Phase 0/1 integrity guarantees. Do not deploy with auto-index disabled until
this inventory is green.

## 1.3 Phase 2 apply commands (production; owner authorization required)

Only these Phase 2 indexes are new. Existing Phase 0/1 indexes must be verified,
not recreated blindly. Run during a low-traffic window after the backup and
duplicate pre-check.

```js
// orders: payment/queue indexes (non-unique)
db.orders.createIndex(
  { paymentStatus: 1, createdAt: -1 },
  { name: "paymentStatus_1_createdAt_-1" }
)
db.orders.createIndex(
  { paymentMethod: 1, createdAt: -1 },
  { name: "paymentMethod_1_createdAt_-1" }
)

// notifications: in-app timeline and outbox lease query
db.notifications.createIndex(
  { user: 1, createdAt: -1 },
  { name: "user_1_createdAt_-1" }
)
db.notifications.createIndex(
  { status: 1, availableAt: 1 },
  { name: "status_1_availableAt_1" }
)

// orders: the H1 readiness gate requires this exact name/options
db.orders.createIndex(
  { "payment.claims.trxIdNormalized": 1 },
  {
    name: "payment_trxid_unique",
    unique: true,
    partialFilterExpression: {
      "payment.claims.trxIdNormalized": { $type: "string" }
    }
  }
)
```

## 1.4 Verification and rollback

Read-only verification:

```js
// Production: print every critical index; compare to section 1.2.
db.getCollectionNames().sort().forEach((name) => {
  print(`--- ${name}`);
  printjson(db.getCollection(name).getIndexes());
});
```

Disposable verification:

```powershell
$env:MONGODB_TEST_MODE='disposable'
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27018/p2_index_test?replicaSet=rs0&directConnection=true'
npm run index-inventory -- --status
npm run payment-index -- --status
```

Expected: 23/23 inventory present, no missing/mismatched critical indexes, and
`payment_trxid_unique` exact. The API `/health` must show `paymentIndex: true`
when a manual provider is enabled.

Rollback (after disabling every manual provider):

```js
db.orders.dropIndex("payment_trxid_unique")
db.orders.dropIndex("paymentMethod_1_createdAt_-1")
db.orders.dropIndex("paymentStatus_1_createdAt_-1")
db.notifications.dropIndex("status_1_availableAt_1")
db.notifications.dropIndex("user_1_createdAt_-1")
```

Do not drop Phase 0/1 indexes as part of a payment rollback. Dropping the payment
unique index while a provider is enabled makes health/manual writes fail closed;
the API will not recreate it.

## 2. Preconditions

1. Owner approval for any production index change.
2. A backup/snapshot of the production `orders` collection.
3. Confirm the deployment is a replica set or sharded cluster.
4. Keep every manual provider disabled in the API environment while migrating.
5. Confirm the production deployment will not start with manual providers
   enabled until the index is verified.
6. Check for duplicate normalized TrxIDs. Existing production orders are COD
   and should have no claims, but run the check anyway.

```js
// Any row here blocks the unique index.
db.orders.aggregate([
  { $unwind: "$payment.claims" },
  { $match: { "payment.claims.trxIdNormalized": { $type: "string" } } },
  { $group: {
      _id: "$payment.claims.trxIdNormalized",
      count: { $sum: 1 },
      orders: { $addToSet: "$_id" }
  } },
  { $match: { count: { $gt: 1 } } }
])
```

Resolution requires an owner-approved reconciliation decision. Do not edit or
delete payment claims just to make the index build pass.

## 3. Disposable replica-set verification (executed)

A cached MongoDB 8.2.6 binary was used to start a disposable single-node replica
set on `127.0.0.1:27018` with a temporary dbpath. No project or production
database was used.

```powershell
$env:MONGODB_TEST_MODE = 'disposable'
$env:MONGODB_TEST_URI = 'mongodb://127.0.0.1:27018/p2_index_test?replicaSet=rs0&directConnection=true'
npm run payment-index -- --apply
npm run payment-index -- --status
npm run payment-index -- --rollback
npm run payment-index -- --status
```

Observed result:

- `--apply`: `Created payment_trxid_unique.` exit 0
- `--status`: index `v: 2`, key
  `{ "payment.claims.trxIdNormalized": 1 }`, `unique: true`, expected
  partialFilterExpression, exit 0
- `--rollback`: `Dropped payment_trxid_unique.` exit 0
- final `--status`: `Index payment_trxid_unique not found.` exit 0

The corrective run repeated apply/status/rollback successfully on
`p2_corrective_index_test`; a duplicate-history target returned `E11000` and
left no index.

The integration suite also asserts the index after `syncIndexes()` on the
disposable database. Corrective H1 tests cover:

- correct index -> ready;
- missing index with a provider enabled -> startup fails and manual writes 503;
- all providers disabled with the index missing -> COD startup and checkout
  succeed;
- wrong key/unique/partial filter -> blocked;
- duplicate historical claims -> `createIndex` fails `E11000`, readiness fails;
- index inspection throw -> startup fails closed;
- reconnection with the index missing -> manual readiness fails closed.

The helper refuses to run unless `NODE_ENV` is not production,
`MONGODB_TEST_MODE=disposable`, the host is loopback, and the database name ends
in `_test` and is not production-like.

## 4. Rollback

```js
db.orders.dropIndex("payment_trxid_unique")
```

Or, on a disposable database only:

```powershell
npm run payment-index -- --rollback
```

Rollback removes only the index. It does not modify orders or claims. If the
application is live with manual payments, dropping the index removes the
database-level duplicate-TrxID guarantee; disable all manual providers first.
The running API will fail manual readiness (health 503 and manual writes 503)
until the index is restored; it will not silently recreate it.

The Phase 2 non-unique indexes (`paymentStatus_1_createdAt_-1`,
`paymentMethod_1_createdAt_-1`, `user_1_createdAt_-1` on notifications,
`status_1_availableAt_1` on notifications) may be dropped only after providers
are disabled and the admin/outbox query impact is accepted. Never drop the
existing Phase 0/1 unique indexes as part of a payment rollback.

## 5. Production sequence (not executed, requires authorization)

1. Record the current deployment as the rollback target.
2. Keep all manual providers disabled.
3. Take/confirm the backup.
4. Run the duplicate pre-check.
5. Run the read-only production index inventory (section 1.2) and compare all
   23 critical indexes. Production `autoIndex` is now disabled by this build, so
   every existing critical index must already be present. Do not create/alter
   production indexes without owner authorization.
6. Create the Phase 2 order/notification indexes and `payment_trxid_unique`
   during a low-traffic window.
7. Verify the exact metadata with read-only `db.orders.getIndexes()` /
   `db.notifications.getIndexes()` (name, key, unique, sparse, partial filter,
   text weights) or `npm run index-inventory -- --status` on a disposable copy.
8. Deploy the API with all manual providers still disabled; verify `/health`
   returns 200 and the COD flow remains healthy.
9. Enable one provider only after owner confirmation; restart so startup
   verifies the index. `/health` must include `paymentIndex: true`.
10. Watch logs for `PAYMENT_TRX_ID_USED`, `PAYMENT_INDEX_UNAVAILABLE` and index
    errors. Add a second provider only after the first provider's reconciliation
    is proven.

If the index build exceeds the maintenance window, stop and roll back the
deployment; do not enable manual payments without the index. If the index is
missing or wrong, startup refuses when a provider is enabled; do not bypass that
check.

## 6. Compatibility and risks

- The index is additive and does not affect COD reads/writes.
- Old application versions do not write `payment.claims`, so they are unaffected
  by the partial filter.
- The index build can consume I/O and disk. MongoDB may require free disk above
  its `indexBuildMinAvailableDiskSpaceMB` threshold.
- The index enforces current and historical claims across documents. MongoDB
  permits duplicate array elements **within one document**; the application's
  pre-check and guarded one-way claim update prevent that path. A future code
  path that appends claims must preserve both guards.
- The index does not detect two different orders that share an un-normalized
  external TrxID if their stored normalized values differ; normalization is
  centralized in `server/src/utils/payment.ts` and the schema.
- Production auto-index is disabled. This is safer but means every existing
  index must be migrated/verified explicitly; a missing order/checkout unique
  index would weaken COD guarantees even though COD still runs.
- This plan and the disposable verification do not constitute authorization to
  touch production indexes or production order data.
