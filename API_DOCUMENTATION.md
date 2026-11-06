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
| POST /auth/logout | public (clears cookie even with expired token) | — | 204 — clears the `al_token` cookie |
| GET /users/me | customer | — | 200 `{ user }` |
| PATCH /users/me | customer | `{ name? }` | 200 `{ user }` |
| GET /users/me/addresses | customer | — | 200 `{ items: [Address] }` |
| POST /users/me/addresses | customer | Address fields | 201 `{ address }` |
| PATCH /users/me/addresses/:id | customer | partial Address | 200 `{ address }` |
| DELETE /users/me/addresses/:id | customer | — | 204 |

`user` = `{ id, email, name, role, addresses }` — never includes passwordHash. Logout = `POST /auth/logout` clears the httpOnly cookie server-side (client JS cannot).

## Catalog (public)
| Endpoint | Request | Response |
|---|---|---|
| GET /categories | — | 200 `{ items: [Category + children[]] }` |
| GET /products | query: `search`, `category` (slug, includes children), `minPrice`, `maxPrice` (poisha), `sizes` (csv), `colors` (csv), `sort` = newest \| price_asc \| price_desc \| relevance, `page`, `limit` | 200 list envelope of ProductCard |
| GET /products/:slug | — | 200 `{ product, variants: [Variant], sizeGuideKey: 'clothing' \| null }` |
| GET /health | — | 200 `{ ok: true }` |

ProductCard: `{ id, name, slug, category, image, priceFrom, priceTo, sizes[], colors[], inStock }`
Variant: `{ id, sku, size, color, price (effective), stock, inStock, lowStock, images[] }` (`lowStock` = stock ≤ lowStockThreshold and > 0).

## Cart (customer — server-side cart)
| Endpoint | Request | Response |
|---|---|---|
| GET /cart | — | 200 `{ items: [{ variantId, product, name, sku, size, color, image, unitPrice, quantity, lineTotal }], subtotal }` |
| POST /cart/items | `{ variantId, quantity }` | 200 cart |
| PATCH /cart/items/:variantId | `{ quantity }` | 200 cart |
| DELETE /cart/items/:variantId | — | 200 cart |
| POST /cart/merge | `{ items: [{ variantId, quantity }] }` | 200 cart — call after login/register with the guest localStorage cart |

## Orders (customer)
| Endpoint | Request | Response |
|---|---|---|
| POST /orders | `{ shippingAddressId }` OR `{ shippingAddress: {...} }`, `paymentMethod: 'cod'` | 201 `{ order }`; 409 on insufficient stock |
| GET /orders | `?page&limit` | 200 list envelope (own orders) |
| GET /orders/:id | — | 200 `{ order }` (own or admin) |
| POST /orders/:id/cancel | — | 200 `{ order }` — pending/processing only; restores stock |

Order JSON: `{ id, orderNumber, status, paymentMethod, paymentStatus, items[], shippingAddress, subtotal, shippingFee, total, statusHistory, createdAt }`.

## Admin (admin)
| Endpoint | Request | Response |
|---|---|---|
| POST /admin/categories | Category fields | 201 `{ category }` |
| PATCH /admin/categories/:id | partial | 200 `{ category }` |
| DELETE /admin/categories/:id | — | 204 (409 if products attached) |
| POST /admin/products | `{ name, description, category, basePrice, images[], status }` | 201 `{ product }` |
| PATCH /admin/products/:id | partial | 200 `{ product }` |
| DELETE /admin/products/:id | — | 204 |
| POST /admin/products/:id/variants | `{ sku, size?, color?, price?, stock, lowStockThreshold? }` | 201 `{ variant }` |
| PATCH /admin/variants/:id | partial | 200 `{ variant }` |
| DELETE /admin/variants/:id | — | 204 |
| GET /admin/variants | `?lowStock=true&page&limit` | 200 list envelope (stock + product refs; low-stock badge when stock ≤ threshold) |
| POST /admin/uploads | multipart `images[]` (jpeg/png/webp, ≤ 5 MB each) | 201 `{ urls: [] }` |
| GET /admin/orders | `?status&page&limit` | 200 list envelope (all orders) |
| PATCH /admin/orders/:id/status | `{ status }` | 200 `{ order }` |
| GET /admin/customers | `?search&page&limit` | 200 list envelope |
| GET /admin/customers/:id | — | 200 `{ user, recentOrders[] }` |

Status updates enforce the transition rules from DATABASE_SCHEMA.md; → `delivered` sets `paymentStatus: 'paid'` (COD); → `cancelled` restores stock once.

## Notes
- All inputs Zod-validated; unknown fields stripped (no mass assignment).
- Prices/totals in responses are integer poisha (100 = 1 BDT); display currency (৳) comes from the single client config constant.
- Partial match search is not supported (MongoDB text index).
