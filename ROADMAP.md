# ROADMAP.md — build order

One session per numbered task. Any task adding a package requests approval first. After each task: type-check + lint clean, then report.

## Phase A — Foundation
1. **Monorepo scaffold** — `/client` (Next.js App Router, TS strict, Tailwind) + `/server` (Express + TS); `.env.example` (PORT, MONGODB_URI, JWT_SECRET, CLIENT_ORIGIN, SHIPPING_FEE (poisha, default 0), ADMIN_EMAIL, ADMIN_PASSWORD); CORS locked to CLIENT_ORIGIN; Next.js rewrites `/api/*` → Express (same-origin); `GET /api/health`; root scripts for dev/type-check/lint. *(Dependencies approved — PROJECT_CONTEXT §7, incl. cookie-parser + express-rate-limit.)*
2. **Data layer** — Mongo connection, Mongoose models (users, categories, products, variants), Zod schemas, slug/orderNumber utils, seed script (admin user, 2 category trees, sample products + variants).
3. **Auth & profile** — register/login (bcryptjs + JWT in httpOnly cookie `al_token`), `POST /auth/logout` (clears cookie), rate limiting on auth routes, `requireAuth` / `requireAdmin` middleware, `/users/me`, addresses CRUD.

## Phase B — Commerce API
4. **Catalog API** — categories tree, products list (text search, filters, sort, pagination), product detail with variants + effective prices + `sizeGuideKey`.
5. **Cart API** — server cart CRUD + `POST /cart/merge` (guest → user).
6. **Orders API** — create order with guarded stock decrement + rollback, own list/detail, cancel with stock restore; `PaymentProvider` interface + `cod` implementation (pluggable for future gateways).
7. **Admin API** — category/product/variant CRUD, image upload (multer), order status management (transition rules + paymentStatus on delivery), low-stock listing.

## Phase C — Storefront
8. **App shell** — layout, header/footer, responsive nav, Tailwind design tokens, reusable Loading/Error/Empty components, API client (`lib/api`).
9. **Catalog UI** — home/landing, listing page (filters, sorting, pagination), PDP (gallery, variant selector, size guide modal, per-variant stock status).
10. **Auth & account UI** — register/login pages, profile, saved addresses.
11. **Cart & checkout UI** — cart page (guest localStorage + merge on login), checkout (address + summary + COD), order confirmation, order history/detail, cancel action.

## Phase D — Admin UI & ship
12. **Admin dashboard UI** — product/variant/category management, image upload, orders (status updates), stock view with low-stock badges.
13. **Hardening & ship** — audit loading/error/empty states on every page, security pass (upload limits, CORS, rate-limit decision), seed polish, final type-check + lint clean, README quickstart.

## Post-MVP backlog (not scheduled)
Wishlist · reviews & ratings · discount codes · online payment gateway · email notifications · related products / recently viewed · sales analytics · returns/exchanges · SEO & sitemap · dark mode.
