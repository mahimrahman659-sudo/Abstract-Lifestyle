# DATABASE_SCHEMA.md — MongoDB + Mongoose

MongoDB (Mongoose ODM). `_id` exposed as `id` in JSON. All collections carry `createdAt`/`updatedAt`. Money: **integer minor units (poisha; 100 = 1 BDT)**; currency code/symbol lives in one client config constant (`config/currency.ts`).

**Collections (6):** `users`, `categories`, `products`, `variants`, `carts`, `orders`. Embedded subdocs: `Address` (in users), `OrderItem` (in orders).

## Relationships
- users 1—* orders · users 1—1 carts · users embeds * addresses
- categories self-reference (parent → subcategory) · categories 1—* products · products 1—* variants
- order items snapshot product/variant data (history survives catalog edits)

## users
| Field | Type | Notes |
|---|---|---|
| email | string | required, unique, lowercase, trimmed |
| passwordHash | string | required (bcryptjs) |
| name | string | required |
| role | 'customer' \| 'admin' | default 'customer' |
| addresses | Address[] | embedded subdoc |

Address subdoc: `_id`, `label?`, `fullName`, `phone`, `line1`, `line2?`, `city`, `state?`, `postalCode?`, `country`, `isDefault` (bool).

**Indexes:** `{ email: 1 }` unique.

## categories
| Field | Type | Notes |
|---|---|---|
| name | string | required |
| slug | string | required, unique |
| description | string | optional |
| parent | ObjectId → categories \| null | two levels only |
| image | string | optional |
| sortOrder | number | default 0 |

Products attach to a subcategory (or a root category when it has no children).

**Indexes:** `{ slug: 1 }` unique; `{ parent: 1, sortOrder: 1 }`.

## products
| Field | Type | Notes |
|---|---|---|
| name | string | required |
| slug | string | required, unique |
| description | string | required |
| category | ObjectId → categories | required |
| basePrice | integer | poisha (1/100 BDT); required |
| images | string[] | URL paths (`/uploads/...`) |
| status | 'draft' \| 'active' \| 'archived' | default 'draft' |

Effective variant price = `variant.price ?? product.basePrice` (computed at service layer).

**Indexes:** `{ slug: 1 }` unique; `{ status: 1, category: 1 }`; text index `{ name: 'text', description: 'text' }` (search).

## variants
| Field | Type | Notes |
|---|---|---|
| product | ObjectId → products | required |
| sku | string | required, unique |
| size | string \| null | e.g. "M"; null for lifestyle default |
| color | string \| null | e.g. "Black" |
| price | integer \| null | optional override (poisha) |
| stock | integer | required, ≥ 0 |
| lowStockThreshold | integer | default 5 |
| images | string[] | optional; falls back to product images |

Every product has **≥ 1 variant**; products without options get one "default" variant (size = null, color = null) so stock/order logic stays uniform.

**Indexes:** `{ product: 1 }`; `{ sku: 1 }` unique; `{ product: 1, size: 1, color: 1 }` unique.

## carts (server-side, customer only)
| Field | Type | Notes |
|---|---|---|
| user | ObjectId → users | required, unique |
| items | { variant → variants, quantity (int ≥ 1) }[] | |
| checkoutInProgress | Date \| null | timestamp of the active checkout claim; claims older than 60s are stale and re-claimable (crash-safe) |

Guest carts live in client localStorage only; `POST /api/cart/merge` folds them into the server cart on login/register.

**Indexes:** `{ user: 1 }` unique.

## orders
| Field | Type | Notes |
|---|---|---|
| orderNumber | string | required, unique — `AL-YYYYMMDD-XXXX` |
| user | ObjectId → users | required (checkout requires login) |
| checkoutId | string (UUID) | idempotency key for checkout retries; unique (sparse) |
| items | OrderItem[] | snapshot subdocs |
| shippingAddress | Address snapshot | fullName, phone, line1, line2?, city, state?, postalCode?, country |
| paymentMethod | 'cod' | extensible union (future gateways) |
| paymentStatus | 'unpaid' \| 'paid' | 'paid' set on delivery for COD |
| subtotal | integer | poisha |
| shippingFee | integer | poisha (flat fee from `SHIPPING_FEE` env) |
| total | integer | poisha = subtotal + shippingFee |
| status | 'pending' \| 'processing' \| 'shipped' \| 'delivered' \| 'cancelled' | default 'pending' |
| statusHistory | { status, at, by? }[] | append-only |
| stockRestored | boolean | default false; guards cancel-restore |

OrderItem subdoc (purchase-time snapshots): `product`, `variant` (refs), `name` (product name), `sku`, `size?`, `color?`, `image?`, `unitPrice`, `quantity`, `lineTotal` (money integers in poisha). Snapshot fields capture product name, SKU, variant size/color and unit price at purchase.

**Indexes:** `{ orderNumber: 1 }` unique; `{ checkoutId: 1 }` unique, sparse (legacy orders without the field are skipped); `{ user: 1, createdAt: -1 }`; `{ status: 1, createdAt: -1 }`.

**Status transitions (enforced server-side):** pending → processing → shipped → delivered; pending | processing → cancelled. No backward jumps; delivered/cancelled are terminal. Customer self-cancel is only allowed from `pending` (guarded transition — stock restored exactly once, double-cancel safe); admin cancels from pending|processing.

## Stock integrity (MongoDB transactions — Atlas replica set)

- **Order create — one transaction:** the per-variant stock decrements, the order creation and the cart clear run inside a single `session.withTransaction()`. Each line still uses the atomic conditional update `Variant.findOneAndUpdate({ _id, stock: { $gte: quantity } }, { $inc: { stock: -quantity } }, { session })`; if any line fails, the whole transaction aborts and **nothing** is decremented (no manual compensating rollback needed). Totals are always computed server-side from DB prices. Transient transaction errors are retried automatically by `withTransaction`; order-number collisions re-run the transaction with a fresh number; the session is always ended.
- **Idempotency:** `checkoutId` (client-generated UUID) is stored under a unique sparse index — posting the same `checkoutId` again returns the existing order instead of creating a second one (concurrent duplicates resolve via the unique index and return the winner).
- **Order cancel (customer + admin) — one transaction:** the guarded status transition, the `stockRestored` flag and the `$inc` stock restoration commit together or not at all; `stockRestored: { $ne: true }` guarantees stock is restored exactly once.
- Checkout double-submits on the same cart are still rejected early by the atomic `checkoutInProgress` claim (stale after 60s); the cart is cleared only when the caller still holds the claim.

