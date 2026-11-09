# API_DOCUMENTATION.md — Express API

Base URL: `http://localhost:4000/api` (browser uses same-origin `/api/*` via Next.js rewrites — no CORS in the browser path). JSON only (except image upload). Auth: **httpOnly cookie** (`al_token`, set on login/register) sent automatically; no bearer token in JS. All state-changing requests require `Content-Type: application/json` (CSRF mitigation).

**Roles:** `public` (no auth) · `customer` (any logged-in user) · `admin` (role admin).

**List response:** `{ "items": [...], "page": 1, "limit": 12, "total": 42, "totalPages": 4 }`

**Error response:** `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "path": "body.email", "message": "Invalid email" }] } }`
Codes: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 (insufficient stock, duplicate email) · `RATE_LIMITED` 429 · `SERVER_ERROR` 500.

## Auth & account
| Endpoint | Role | Request | Response |
|---|---|---|---|
| POST /auth/register | public | `{ email, password (min 8), name }` | 201 `{ user }` + `Set-Cookie: al_token` (HttpOnly, SameSite=Lax, Secure in prod) |
| POST /auth/login | public | `{ email, password }` | 200 `{ user }` + `Set-Cookie: al_token` |
| POST /auth/google | public | `{ credential }` (Google Identity Services ID token, max 4096 chars) | 200 `{ user }` + `Set-Cookie: al_token` |
| POST /auth/logout | public (clears cookie even with expired token) | — | 204 — clears the `al_token` cookie |
| GET /users/me | customer | — | 200 `{ user }` |
| PATCH /users/me | customer | `{ name? }` | 200 `{ user }` |
| GET /users/me/addresses | customer | — | 200 `{ items: [Address] }` |
| POST /users/me/addresses | customer | Address fields | 201 `{ address }` |
| PATCH /users/me/addresses/:id | customer | partial Address | 200 `{ address }` |
| DELETE /users/me/addresses/:id | customer | — | 204 |

`user` = `{ id, email, name, role, addresses }` — never includes passwordHash or googleId. Logout = `POST /auth/logout` clears the httpOnly cookie server-side (client JS cannot).

**Google sign-in (`POST /auth/google`):** the `credential` is a Google Identity Services ID token, verified server-side with `google-auth-library` (`verifyIdToken`, audience = `GOOGLE_CLIENT_ID`). **Any** verification failure (bad signature, expired, wrong audience, unverified email, missing claims) returns the same generic `401 { error: { code: "UNAUTHORIZED", message: "Google sign-in failed" } }`. Only `email_verified === true` tokens are accepted. Lookup order: `googleId` match → normalized-email match (the Google account is then **linked** to the existing user — safe because the email is Google-verified; password and role are untouched) → new **customer** account is created (name/email from the token; role is always `customer`, never taken from the token or request). Successful sign-in behaves exactly like `POST /auth/login`: user DTO in the body (never a token) + the same `al_token` HttpOnly cookie. Rate-limited like the other credential endpoints (10/15 min per IP). Google-only accounts (no password) cannot use `POST /auth/login` — it fails with the same generic `Invalid email or password` error as a wrong password.

## Catalog (public)
| Endpoint | Request | Response |
|---|---|---|
| GET /categories | — | 200 `{ items: [Category + children[]] }` |
| GET /products | query: `search`, `category` (slug, includes children), `minPrice`, `maxPrice` (poisha), `sizes` (csv), `colors` (csv), `sort` = newest \| price_asc \| price_desc \| relevance, `page`, `limit` | 200 list envelope of ProductCard |
| GET /products/:slug | — | 200 `{ product, variants: [Variant], sizeGuideKey: 'clothing' \| null }` |
| GET /health | — | 200 `{ ok: true }` |

ProductCard: `{ id, name, slug, category, image, priceFrom, priceTo, sizes[], colors[], inStock, createdAt }` (`createdAt` = ISO 8601 creation timestamp; the client uses it to show a "New" badge only for products created within the last 14 days)
Variant: `{ id, sku, size, color, price (effective), stock, inStock, lowStock, images[] }` (`lowStock` = stock ≤ lowStockThreshold and > 0).
Product (detail): `{ id, name, slug, description, category, basePrice, images[], createdAt }` (`createdAt` = ISO 8601 creation timestamp; the client uses it to show a "New Arrival" flag only for products created within the last 14 days).

## Cart (customer — server-side cart)
| Endpoint | Request | Response |
|---|---|---|
| GET /cart | — | 200 `{ items: [{ variantId, product, name, sku, size, color, image, unitPrice, quantity, lineTotal, outOfStock, insufficientStock, unavailable }], subtotal, shippingFee, total }` |
| POST /cart/items | `{ variantId, quantity (1–20) }` | 200 cart — existing line's quantity increases, capped at available stock |
| PATCH /cart/items/:variantId | `{ quantity (1–20) }` | 200 cart — capped at available stock |
| DELETE /cart/items/:variantId | — | 200 cart (idempotent) |
| DELETE /cart | — | 200 cart — removes all items |
| POST /cart/merge | `{ items: [{ variantId, quantity }] }` | 200 cart — call after login/register with the guest localStorage cart; invalid/unavailable entries are skipped |

Cart notes: prices/stock are always recomputed from the DB (`unitPrice = variant.price ?? product.basePrice`, `lineTotal = unitPrice × quantity`, `subtotal` = Σ lineTotals, integer poisha). `shippingFee` = flat fee from `SHIPPING_FEE` env (poisha) and `total` = subtotal + shippingFee — the cart response is the client's only pre-order source for the shipping fee. Flags: `unavailable` = variant missing or product inactive/removed · `outOfStock` = stock 0 · `insufficientStock` = quantity &gt; stock. Quantity is an integer 1–20 per request.

## Orders (customer)
| Endpoint | Request | Response |
|---|---|---|
| POST /orders | `{ checkoutId (UUID), shippingAddressId }` OR `{ checkoutId, shippingAddress: {...} }`, `paymentMethod: 'cod'` | 201 `{ order }`; 409 on insufficient stock / empty cart / in-progress checkout. Idempotent: replaying the same `checkoutId` returns the existing order |
| GET /orders | `?page&limit` | 200 list envelope (own orders, newest first) |
| GET /orders/:id | — | 200 `{ order }` (own or admin) |
| POST /orders/:id/cancel | — | 200 `{ order }` — customer cancel only from `pending`; restores stock exactly once (double-cancel safe); 409 otherwise |

Order JSON: `{ id, orderNumber, checkoutId, status, paymentMethod, paymentStatus, items[], shippingAddress, subtotal, shippingFee, total, statusHistory, createdAt }`. `items[]` = purchase-time snapshots `{ product, variant, name, sku, size, color, image, unitPrice, quantity, lineTotal }`. Checkout re-validates and re-prices everything from the DB (never accepts client items/prices); the per-line stock decrements, the order creation and the cart clear run in **one MongoDB transaction** (Atlas replica set), so any failure aborts everything; concurrent checkouts on the same cart are rejected with 409. `checkoutId` is a client-generated UUID stored under a unique (sparse) index — a repeated request with the same `checkoutId` returns the original order instead of creating a second one.

## Admin (admin)
| Endpoint | Request | Response |
|---|---|---|
| POST /admin/categories | Category fields | 201 `{ category }` — slug generated from name (unique) |
| PATCH /admin/categories/:id | partial | 200 `{ category }` |
| DELETE /admin/categories/:id | — | 204 (409 if it has subcategories or products) |
| GET /admin/products | `?search&status&page&limit` | 200 list envelope (all statuses; `status` = draft \| active \| archived) |
| GET /admin/products/:id | — | 200 `{ product, variants[] }` (any status — for editing) |
| POST /admin/products | `{ name, description, category, basePrice, images[{ url, publicId }], status }` | 201 `{ product }` — slug generated from name (unique); removed image assets are deleted from Cloudinary |
| PATCH /admin/products/:id | partial | 200 `{ product }` |
| DELETE /admin/products/:id | — | 204 hard delete; **200 `{ product, archived: true }` when referenced by orders** (archived, not deleted) |
| POST /admin/products/:id/variants | `{ sku, size?, color?, price?, stock, lowStockThreshold? }` | 201 `{ variant }` (409 on duplicate SKU or duplicate size/color) |
| PATCH /admin/variants/:id | partial | 200 `{ variant }` — stock set with `$set`, non-negative integers only |
| DELETE /admin/variants/:id | — | 204 (409 if it is the product's last variant) |
| GET /admin/variants | `?lowStock=true&page&limit` | 200 list envelope (variant + product ref + `inStock`/`lowStock` flags) |
| POST /admin/uploads | multipart `images[]` (jpeg/png/webp, ≤ 5 MB each, max 10) | 201 `{ assets: [{ url, publicId }] }` — content-verified (magic bytes) then uploaded to Cloudinary (`abstract-lifestyle/products`, cloud-generated public_id); `url` is the secure https URL |
| GET /admin/orders | `?status&page&limit` | 200 list envelope (all orders) |
| GET /admin/orders/:id | — | 200 `{ order, customer: { id, name, email } \| null }` (any user's order) |
| PATCH /admin/orders/:id/status | `{ status }` | 200 `{ order }` |
| GET /admin/customers | `?search&page&limit` | 200 list envelope |
| GET /admin/customers/:id | — | 200 `{ user, recentOrders[] }` |

Status updates enforce allowed transitions only: **pending → processing → shipped → delivered**; **cancelled from pending or processing**; anything else → 409. → `delivered` sets `paymentStatus: 'paid'` (COD); → `cancelled` restores stock exactly once (atomic transition + `stockRestored` guard; already-cancelled orders never restore again). Every change is appended to `statusHistory` (with the admin's id).

## Notes
- All inputs Zod-validated; unknown fields stripped (no mass assignment).
- Prices/totals in responses are integer poisha (100 = 1 BDT); display currency (৳) comes from the single client config constant.
- Partial match search is not supported (MongoDB text index).
