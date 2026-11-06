# PROJECT_CONTEXT.md — "Abstract Lifestyle"

E-commerce MVP: online store for **clothing (main category)** plus **daily-use lifestyle products** (accessories, bags, bottles, small home & everyday items). Not an art/print store.

## 1. Goals
- Shippable MVP: browse → search/filter → product page → cart → COD checkout → order history; admin manages catalog, stock, and orders.
- Mobile-first, clean UI. Small scope. No nice-to-haves in this release.

## 2. Users & roles
| Role | Access |
|---|---|
| Guest | Browse/search catalog, guest cart (localStorage) |
| Customer | Register/login, profile, saved addresses, checkout (COD), order history, cancel own orders |
| Admin | Customer powers + catalog CRUD, image upload, order status management, stock tracking & low-stock |

## 3. MVP feature scope
**Must-have (build now)**
- Catalog: categories & subcategories, search, filters (category, price, size, color), sorting, pagination
- Variants: size/color, own SKU, optional price override, images, stock per variant
- PDP: image gallery, variant selector, size guide, price, per-variant stock status
- Cart: persistent for customers (server-side), guest cart (localStorage), merge on login
- Checkout: shipping address + order summary, **Cash on Delivery**
- Payments: pluggable layer (`PaymentProvider`); only `cod` implemented now
- Auth & accounts: register/login/logout, profile, saved addresses, order history
- Orders: pending → processing → shipped → delivered; cancel (pending/processing only); **stock decrements on order, restores on cancel**
- Admin dashboard: product/variant/category CRUD, image upload, order management, stock tracking + low-stock indicator
- Role-based access (customer vs admin); responsive, mobile-first; loading/error/empty states in every UI

**Deferred (nice-to-haves — do NOT build now; design does not block them)**
Wishlist · reviews & ratings · discount codes · online payment gateway · email notifications · related products / recently viewed · admin sales analytics · returns/exchanges · SEO metadata & sitemap · dark mode.

## 4. Folder structure
```
/client                        Next.js App Router + TS (strict) + Tailwind
  app/                         routes & pages (UI only — calls the Express API)
  components/                  UI components
  lib/                         api client (fetch wrappers), types, utils (money, cn)
/server                        Express + TS + MongoDB (Mongoose)
  src/
    config/                    env loading & validation
    models/                    Mongoose models
    schemas/                   Zod schemas (all API input validation)
    routes/                    route definitions only
    controllers/               request/response handling
    services/                  business logic (stock, orders, payments)
    middleware/                auth, validate, error handler
    utils/                     slug, orderNumber, money
    scripts/                   seed.ts
    index.ts                   bootstrap
  uploads/                     product images (git-ignored)
```
Business logic lives only in /server. Next.js never duplicates backend logic; it calls the Express API via same-origin `/api/*` (Next.js rewrites proxy to Express — required for cookie auth) through `lib/api`.

## 5. Conventions
- TypeScript strict; **no `any`**. Client types mirror API shapes in `client/lib/types` (kept in sync manually — simplest).
- **Every API input validated with Zod** (body/query/params) in `/server/src/schemas`.
- Express layering: routes → controllers → services → models.
- Every UI: loading, error, and empty states handled.
- Secrets via environment variables only; keep `.env.example` updated.
- Money stored as **integer minor units (poisha; 100 = 1 BDT)**. Currency code, symbol (৳) and display formatting live in one config constant (`config/currency.ts`).
- After each task: run type-check and lint, then report changed files, what was done, what is unfinished.

## 6. Decisions & assumptions (simplest option chosen — say "change" to revise)
| Ambiguity | Decision |
|---|---|
| Currency & pricing | **BDT (৳)**, no taxes; prices as integers in poisha (smallest unit, 100 = 1 BDT); currency kept in one config constant |
| Guest checkout | Not in MVP — checkout requires login; guest cart merges on login/register |
| Shipping cost | Flat fee from `SHIPPING_FEE` env (integer poisha, default 0); no carrier integration |
| Size guide | Static clothing size-chart component (not DB-managed) |
| Products without options | Every product has ≥ 1 variant; no-option lifestyle products get one "default" variant (size/color = null) |
| Stock decrement | Guarded atomic `findOneAndUpdate` + compensating rollback; no transactions (works on standalone Mongo) |
| Order cancellation | Only from pending/processing; stock restored once (guarded by `stockRestored`) |
| Auth transport | Browser talks to same-origin `/api/*` via Next.js rewrites → Express; `cors` kept locked to `CLIENT_ORIGIN` as a safety net for direct access |
| Auth token storage | JWT in **httpOnly cookie** (`al_token`): `httpOnly: true`, `sameSite: 'lax'`, `secure: true` in production (off over local http), `maxAge` = JWT expiry (7d) |
| Logout | `POST /auth/logout` clears the cookie server-side (JS cannot touch httpOnly); JWT stays stateless |
| Image storage | **Cloudinary** (`abstract-lifestyle/products`, API-generated public_id); product images store `{ url, publicId }`; legacy `/uploads/...` strings still read; local disk no longer written |
| Search | MongoDB text index on name + description; no fuzzy/partial match |
| Order snapshots | Order items copy product name, variant size/color, SKU, unit price, image at purchase (history survives catalog edits) |
| Admin bootstrap | Seed script creates admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env |
| Price integrity | Totals computed server-side from DB prices; client prices never trusted |
| Pagination | `page` / `limit` (default 12, max 50) |

## 7. Dependencies (approved 2026-11-06 — nothing else without asking)
| Where | Packages | Purpose |
|---|---|---|
| server | express, mongoose, zod, jsonwebtoken, bcryptjs, cors, dotenv, multer, cookie-parser, express-rate-limit, helmet, cloudinary, google-auth-library | runtime |
| server | typescript, tsx, @types/*, eslint | dev |
| client | next, react, react-dom, typescript, tailwindcss, eslint | via create-next-app |
| not approved | helmet or anything else | ask first |

## 8. Security concerns
- bcryptjs password hashing; strong `JWT_SECRET` from env (never committed).
- Zod validation + field whitelisting on every write (no mass assignment).
- Totals & stock resolved server-side (no client-supplied prices).
- Uploads: mime-type + size limits (≤ 5 MB), random filenames, served only from `/uploads`.
- Auth cookie is **httpOnly** (no JS access), `sameSite: 'lax'`, `secure` in production — immune to token theft via XSS reads.
- CSRF: `sameSite: 'lax'` + strict `Content-Type: application/json` on state-changing routes (cross-site form posts cannot reach them). No CSRF token for MVP.
- CORS locked to `CLIENT_ORIGIN` env (safety net; browser traffic is same-origin via rewrites).
- Rate limiting (`express-rate-limit`) on auth endpoints.

## 9. Risks
- **Stock without transactions:** multi-item orders use compensating rollback on standalone Mongo (small race window). Upgrade path: replica set + transactions.
- **Dependency policy:** approved list only (§7); anything else (e.g. helmet) asks first.
- **Local disk uploads** don't scale to multi-instance deploys (swap to cloud storage later).
- **Text search** won't match partial words (e.g. "t-shi" misses "T-shirt").
- **Front-end price display** must handle poisha integers correctly everywhere (single `formatMoney` util + one currency config constant).

## 10. Decisions (confirmed 2026-11-06)
1. Currency: BDT (৳), no taxes; prices stored as integer poisha; currency in one config constant (`config/currency.ts`).
2. Login required at checkout (no guest checkout); guest cart (localStorage) merges into server cart on login.
3. Flat shipping fee via `SHIPPING_FEE` env (poisha, default 0).

