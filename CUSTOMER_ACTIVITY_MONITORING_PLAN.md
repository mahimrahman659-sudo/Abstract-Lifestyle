# CUSTOMER_ACTIVITY_MONITORING_PLAN.md — Customer Activity Center (Final Architecture Plan)

**Mode:** Phase 0 — read-only audit and design approval. No implementation changes, no dependencies, no DB/index access, no commits/pushes/deploys, no payment-provider activation.
**Repository:** `C:\Project\Abstract Lifestyle` · Branch at audit: `feature/manual-mfs-payments`.
**Owner decision recorded:** combined **Customer Activity Center** with three capabilities — (1) near-real-time visitor monitoring, (2) individual customer activity history under privacy constraints, (3) business-growth analytics (products, carts, funnels). P0 foundation + live monitoring + basic timelines first; advanced analytics later.

---

## 0. Findings from the repository audit (verified)

> Every claim below was verified in source during this audit. **No activity-tracking, analytics, consent, or event schema exists today** — this is a greenfield feature.

### 0.1 Existing analytics / logging / consent

| Finding | Evidence |
|---|---|
| **No analytics, tracking, beacon, or telemetry code anywhere** (no gtag/posthog/segment/sendBeacon/`instrumentation.ts`) | Repo-wide grep across `client/**/*.{ts,tsx}` — zero matches outside `package-lock.json` noise |
| **No consent mechanism** — no cookie banner, no preference store, no opt-out; privacy page is 2 short paragraphs and never mentions behavioral data | `client/app/privacy/page.tsx:13-19`; repo-wide grep for `consent\|opt-out\|cookie banner` → no source hits |
| Only request observability: stdout one-liner on `res.finish`, never persists, never logs bodies/cookies/headers/query | `server/src/middleware/request-logger.ts:7-21`, mounted `server/src/app.ts:21` |
| No logging library (no winston/pino/morgan/sentry/prom-client) | `server/package.json:25-39` |
| Prior audit already flagged request logging as unstructured (finding D14) | `AUDIT_REPORT.md:268` |
| "Sales analytics" is post-MVP backlog, unscheduled; no activity-monitoring item on roadmap | `ROADMAP.md:27` |

### 0.2 Authentication / sessions / admin authorization

| Finding | Evidence |
|---|---|
| Stateless JWT in httpOnly cookie `al_token` (7d); **no server session store**; logout only clears cookie | `server/src/utils/jwt.ts:14-32`; `server/src/controllers/auth.controller.ts:42-46` |
| `requireAuth` re-reads the user from Mongo on **every** authenticated request — natural attribution choke point | `server/src/middleware/auth.ts:9-23` |
| **All** admin endpoints inherit `requireAuth + requireRole('admin')` via router-level guard; role re-read from DB per request; prior audit found no IDOR | `server/src/routes/admin.routes.ts:46`; `AUDIT_REPORT.md:§6.3` |
| Roles `customer \| admin`; registration forces `customer`; admin set only by script | `server/src/models/user.model.ts:3,57`; `server/src/services/auth.service.ts:34,99`; `server/src/scripts/set-role.ts` |
| Admin UI guard is client-side `RequireAdmin` (convenience only — API is authority); no Next `middleware.ts` exists | `client/components/auth/RouteGuard.tsx:36-64` |
| **No customer-data access audit exists** — admins can already read customers/orders with no record of who viewed what | `admin.routes.ts:101-102`; no other read-audit code in repo |

### 0.3 Customer / order / cart data available for reuse

| Data | Reuse for Activity Center | Evidence |
|---|---|---|
| `orders` — full snapshots, `statusHistory[] {status, at, by?}`, `payment.verificationHistory[]` | Timeline shows order facts **read-only from `orders`**; never re-recorded as events | `server/src/models/order.model.ts:97-101, 37-48` |
| `adminGetCustomer` already returns user + `recentOrders[]` | Customer detail timeline extends this endpoint's service | `server/src/services/admin-customer.service.ts:71-85` |
| `GET /api/admin/customers` (list, search by name/email) — **API exists, no UI page** | `/admin/customers` list page reuses it unchanged | `admin.routes.ts:101`; `admin-customer.service.ts:41-69` |
| `carts` — server-side per-user carts with `items[]`, `updatedAt`, `checkoutInProgress`, `version` | Cart-abandonment analysis source for **logged-in customers only** | `server/src/models/cart.model.ts:8-20,45` |
| Guest cart lives **only in browser localStorage** (`al_guest_cart`) — server never sees it | Guest-cart abandonment is **not measurable server-side** (limitation, §5.6) | `client/components/cart/CartProvider.tsx:17` |
| `variants` live `stock`/`price` for product analytics joins | Product funnel value calculations | `server/src/models/variant.model.ts` |
| `notifications` transactional outbox pattern (lease-based) | **Not needed** for events (best-effort), but the pattern is the precedent if reliability is ever required | `server/src/models/notification.model.ts:12-16` |

### 0.4 Event sources / instrumentation choke points (client)

| Event opportunity | Exact location |
|---|---|
| Add to cart | `client/components/catalog/PurchasePanel.tsx:107-151` (`handleAddToCart`, `addItem` at :120) |
| Cart mutations (server + guest) | `client/components/cart/CartProvider.tsx:139-207` |
| Cart → checkout CTA | `client/components/cart/CartPageClient.tsx:356-364, 389-396` |
| Purchase (order created) | `client/components/checkout/CheckoutClient.tsx:279` (`orderApi.create`) |
| Purchase confirmation | `client/components/orders/OrderDetailClient.tsx:57` (`justPlaced`) |
| Search submit | `client/components/layout/Header.tsx:76-82`; `client/components/catalog/ProductsView.tsx:109-113` |
| Filter/sort/pagination | `client/components/catalog/ProductFilters.tsx:48`; `ProductsView.tsx:115-121` |
| Product card impression/click | `client/components/catalog/ProductCard.tsx:26,31,55,81` |
| Login/register/logout | `client/components/auth/AuthProvider.tsx:68-96` |
| Global route changes (`usePathname`) | already used in `RouteGuard.tsx:16`, `Header.tsx:37`, `AdminShell.tsx:50` — tracker mounts beside these |
| Provider stack insertion point | `client/components/providers/Providers.tsx:8-17` (`AuthProvider → CartProvider → CheckoutDraftGuard → children`) |

### 0.5 Infrastructure facts the design must respect

- **Middleware order:** `requestLogger → helmet → cors → json → cookieParser → /api router → 404 → errorHandler` (`server/src/app.ts:21-45`); all routes mounted under `/api` (`server/src/routes/index.ts:18-30`); browser reaches Express only via Next rewrites (`next.config.ts:46-58`).
- **Rate limiting:** in-memory `express-rate-limit` — global 300/min/IP (`API_RATE_LIMIT_PER_MIN`), auth 10/15min/IP, order 30/min per user-or-ip, upload 20/min; factory `perMinuteLimiter()` + `userOrIpKey` reusable (`server/src/middleware/rate-limit.ts:22-61`; defaults `server/src/config/env.ts:32-36`).
- **Validation:** Zod per-domain schemas in `server/src/schemas/`; `validateBody` replaces `req.body` with parsed/stripped value (`server/src/middleware/validate.ts:5-8`); query/params parsed in controllers; PATCH-without-defaults rule in `AGENTS.md`.
- **Transactions:** checkout/cancel/admin/payment/catalog use `session.withTransaction`; API refuses standalone mongod (`server/src/config/db.ts:36-109`, `config/mongo-capabilities.ts:31-81`). Checkout commits at `order.service.ts:363`, `provider.onOrderPlaced` at :481, `finally` at :483 — **the safe post-commit window for emitting `order.purchased`**.
- **Indexes:** 6 collections; unique indexes on `carts{user}`, `orders{orderNumber}`, sparse `orders{checkoutId}`, partial payment trxId, `variants{sku}` — **a new events collection touches none of them**. `autoIndex` only in development (`db.ts:51-53`); production index creation is a separate approved rollout (precedents: `PAYMENT_INDEX_MIGRATION_PLAN.md:149` "record rollback target first"; phone indexes still pending, `AUDIT_PHASE1_IMPLEMENTATION_REPORT.md:98`).
- **Deployment:** Vercel (client) + Render (server) + Atlas, no Docker (`DEPLOYMENT.md:36-56`); `TRUST_PROXY=1` required in prod (`env.ts:116-123`); health `GET /api/health → {ok, transactions}`; no rollback procedure in `DEPLOYMENT.md`.
- **Tests:** 9 server + 5 client + 1 browser, `node:test`; commands `npm run type-check`, `npm run lint`, server `npm test` (`server/package.json:18-23`, `client/package.json:5-13`).
- **Dependencies:** approved list only — **no new packages** (`PROJECT_CONTEXT.md:83-89`).
- **Admin nav:** single array `NAV_ITEMS` (`client/components/admin/AdminShell.tsx:10-16`); admin pages are ~10-line wrappers around `components/admin/*`; canonical loading/error/empty + `reloadKey` pattern in `AdminOrders.tsx:44-47,68-97,204-260`.
- **Working tree (at audit):** dirty — 33 modified/deleted + 37 untracked entries; Phase 1 must not start until owner settles this (§10 D7).

### 0.6 Assumptions & items that could not be verified

| ID | Item | Status |
|---|---|---|
| U1 | Traffic volume (visits/day, events/visit) | **UNKNOWN** — no analytics exist; storage estimates in §8 are assumptions, labeled |
| U2 | Atlas tier, storage quota, backup policy | **UNKNOWN** — no production DB access permitted in this phase |
| U3 | Whether owner requires an explicit consent banner vs privacy-notice-only | **OWNER DECISION D1** — not derivable from repo |
| U4 | Retention period acceptable to owner | **OWNER DECISION D2** |
| U5 | Current dirty-tree state may have changed since audit | Re-verify `git status` before Phase 1 |
| U6 | Render instance size / free-tier limits | **UNKNOWN** — not in repo docs |
| U7 | Whether admins expect mobile live-dashboard use | Assumed desktop-first (matches existing admin UI) |

---

## 1. Prioritized task breakdown

| Pri | Task | Phase | Depends on |
|---|---|---|---|
| **P0-1** | Event model + Zod schemas + `activity.service.ts` (ingest, dedup, identity rules) | 1 | Design approval (this doc) |
| **P0-2** | `POST /api/events` route + `eventRateLimiter` + feature flag `ACTIVITY_EVENTS_ENABLED` (default **off**) | 1 | P0-1 |
| **P0-3** | Server-authoritative emitters: auth, cart, checkout-started, purchase, cancel — **post-commit, fire-and-forget** | 1 | P0-1 |
| **P0-4** | Privacy: update `privacy/page.tsx`; deny-list enforcement tests; `al_anon_id` issuance (client, flag-gated) | 1 | D1/D2 settled |
| **P0-5** | Security/privacy test suite (spoof, dedup, rate-limit, PII-strip, checkout-nonblocking, authz) | 1 | P0-1..3 |
| **P0-6** | Admin reads: `GET /admin/activity/live`, `/recent`, `/customers/:id/timeline` + customer-access audit events | 2 | Phase 1 accepted |
| **P0-7** | Admin UI: `/admin/activity` (live + feed), `/admin/customers` list, `/admin/customers/[id]` timeline; `NAV_ITEMS` | 2 | P0-6 |
| **P0-8** | Date/type filters + pagination on feed & timeline | 2 | P0-6 |
| **P1-1** | Client tracker (queue, batch, beacon) + browse instrumentation (page/product/search/filter/cart-CTA) | 3 | D1 = collect; Phase 2 accepted |
| **P1-2** | Product analytics endpoint + UI (views, ATC rate, purchase rate) | 3 | P1-1 |
| **P1-3** | Conversion funnel (view → ATC → checkout → purchase) + UI | 3 | P1-1, P0-3 |
| **P1-4** | Cart-abandonment report (server carts) + UI | 3 | P0-3, P1-1 |
| **P1-5** | Consent withdrawal path (client kill-switch + server honoring, per D1) | 3 | D1 |
| **P2-1** | Independent verification: test audit, load smoke, privacy field spot-check, review gates | 4 | Phases 1–3 code-complete |
| **P2-2** | Index rollout (separate authorization, rollback target recorded first) + TTL activation | 4 | P2-1 passed |
| **P2-3** | Controlled release: flag on in stages, monitor, rollback drill | 4 | P2-2 |

---

## 2. Architecture diagram

```
┌──────────────────────── Browser (Vercel /client) ────────────────────────┐
│                                                                         │
│  Storefront                          Admin (RequireAdmin → AdminShell)   │
│  PDP · catalog · cart · checkout     /admin/activity · /admin/customers  │
│        │                                    │                            │
│  ┌─────▼───────────────────┐       ┌────────▼──────────┐                 │
│  │ ActivityTracker (new)   │       │ Activity UI       │                 │
│  │ Providers.tsx child     │       │ live · feed ·     │                 │
│  │ flag: ACTIVITY_TRACKING │       │ timeline · filters│                 │
│  │ al_anon_id (localStorage│       └────────┬──────────┘                 │
│  │  al_session_id sessionStorage            │ apiFetch (admin cookie)    │
│  │  consent: al_tracking_consent            │                            │
│  │  queue → batch(≤20) → sendBeacon/keepalive                           │
│  └─────┬───────────────────┘                                            │
└────────┼─────────────────────────────────────────────────────────────────┘
         │  POST /api/events          GET /api/admin/activity/* (admin only)
         │  (same-origin via next.config.ts rewrites /api/:path* → Express)
┌────────▼─────────────────────────────────────────────────────────────────┐
│                      Express API (Render /server)                        │
│                                                                          │
│  app.ts: requestLogger → helmet → cors → json → cookieParser → /api      │
│                                                                          │
│  POST /api/events                                                        │
│    → apiRateLimiter → eventRateLimiter (NEW, 60/min userOrIp)            │
│    → validateBody(eventBatchSchema)   [≤20 events, closed type enum]     │
│    → activityService.ingest()                                          │
│         · identity: userId FROM COOKIE ONLY (client userId discarded)   │
│         · anon: anonymousId + sessionId (client-supplied, format-checked)│
│         · path normalized (allowlist, no query string)                   │
│         · ts clamped [now-24h, now+5min]                                 │
│         · insertMany(ordered:false) → E11000 counted as deduped          │
│         · ALL errors swallowed — never fails the request                 │
│                                                                          │
│  Server emitters (source:'server', called by existing services):         │
│    auth.controller/auth.service → auth.*                                 │
│    cart.service → cart.*                                                 │
│    order.service:363 txn → AFTER commit (:474+) → checkout.started /     │
│                   order.purchased / order.cancelled  [never inside txn]  │
│    admin-order.service / payment-claim.service / admin-catalog → admin.* │
│    activity controller (timeline GET) → admin.customer_viewed (audit)    │
│                                                                          │
│  GET /api/admin/activity/* ── requireAuth + requireRole('admin')         │
│    (inherited from adminRouter.use at admin.routes.ts:46)                 │
│                                                                          │
│  ACTIVITY_EVENTS_ENABLED=false ⇒ emitters no-op, ingest returns 204,     │
│  admin reads return empty — zero writes, zero behavior change            │
└──────────────────────────────┬───────────────────────────────────────────┘
                               ▼
┌──────────────────── MongoDB Atlas ───────────────────────────────────────┐
│ activity_events (NET-NEW collection)                                     │
│   unique {eventId} · {type,ts} · {userId,ts} · {sessionId,ts} ·          │
│   {productId,ts} · {ts}+TTL(expireAfterSeconds, owner-set)               │
│ activity_consent (NET-NEW, only if D1 requires server-side consent)      │
│ orders / users / carts / variants  → READ-ONLY for dashboards            │
│ (no existing index or schema modified)                                   │
└──────────────────────────────────────────────────────────────────────────┘

Rollout: code deploys FIRST with flag off → tests → owner-approved index
rollout (rollback target recorded first, precedent: payment-index plan) →
staged flag-on. No new npm dependencies in any phase.
```

**Design invariants (non-negotiable):**

1. **Server wins identity** — `userId` only from verified `al_token` cookie (`middleware/auth.ts:9-23`); client-supplied `userId` discarded in Zod transform + service guard.
2. **Business events are server-emitted** — `order.purchased` written only by `order.service.ts` after `withTransaction` resolves; client purchase beacons are never authoritative.
3. **Monitoring never touches checkout** — event writes happen post-commit with `.catch()`; a failed event insert must never fail an order (tested in §7).
4. **Best-effort, not ledger** — event loss under load is acceptable; order/stock corruption is not.
5. **Flag-first** — every phase ships behind `ACTIVITY_EVENTS_ENABLED` (server) / `NEXT_PUBLIC_ACTIVITY_TRACKING` (client) defaulting off until Phase 4 release.

---

## 3. Dashboard wireframe & navigation

### 3.1 Navigation change (Phase 2)

`client/components/admin/AdminShell.tsx:10-16`:

```ts
const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/activity', label: 'Activity' },       // NEW (P0)
  { href: '/admin/customers', label: 'Customers' },     // NEW (P0)
  { href: '/admin/site-images', label: 'Site Images' },
];
```

New routes follow the thin-wrapper pattern (`app/admin/<route>/page.tsx` ≈ 10 lines → component in `components/admin/`), all inside `AdminShell` → `RequireAdmin`.

### 3.2 `/admin/activity` — Live + feed (Phase 2 MVP)

```
┌ AdminShell ───────────────────────────────────────────────────────────────┐
│ [Dashboard][Orders][Products][Categories][Activity•][Customers][Images]   │
├───────────────────────────────────────────────────────────────────────────┤
│ Activity · live monitoring                          flag: ON · updated 8s │
│ ┌─────────────────── LIVE (last 5 min) ──────────────────── [auto 30s] ┐ │
│ │ 👥 14 active visitors   🛒 3 with items in cart   📦 1 checkout open │ │
│ │  · anon·a19f  /products/linen-shirt        12s ago                   │ │
│ │  · cust·Rahim /cart                         41s ago                  │ │
│ │  · anon·7c2b  /                             2m ago                   │ │
│ │  (label: "Approximate — derived from recent events, not exact       │ │
│ │   sessions; refreshes every 30 seconds")                             │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ Stat cards (selected range)  [Range: 24h | 7d | 30d ▾]  [From ___ To ___]│
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ Visitors │ │Page views│ │Add-to-cart│ │Checkouts │ │Purchases │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│                                                                           │
│ Recent activity            [Type ▾] [Source ▾] [Customer ▾]              │
│ ┌───────────────────────────────────────────────────────────────────────┐│
│ │ 14:02  order.purchased  Rahim U.     ৳2,450  AL-2026…        [order] ││
│ │ 14:01  cart.add         anonymous    Linen Shirt / L ×2              ││
│ │ 13:58  page.view        Rahim U.     /products/linen-shirt          ││
│ │ 13:55  auth.login       Karim A.     method=password                ││
│ │ 13:44  admin.order_status_changed   by Admin X  pending→processing  ││
│ │                              [< Prev]  1 of 12  [Next >]             ││
│ └───────────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────┘
```

States: `loading → Skeleton` / `error → ErrorState + reloadKey retry` / `empty → EmptyState` — copy `AdminOrders.tsx:204-260` exactly. Live panel: own 30 s poll, degrades to "live unavailable" notice on error without breaking the feed.

### 3.3 `/admin/customers` + `/admin/customers/[id]` — Timeline (Phase 2)

```
/admin/customers            → list via existing GET /api/admin/customers (name/email search)
/admin/customers/[id]       → detail
┌ … ───────────────────────────────────────────────────────────────────────┐
│ Karim Ahmed · karim@… · joined 2026-09-01                [Copy email]     │
│ Tabs: [Activity] [Orders]          ← hand-rolled ARIA tabs (ProductTabs  │
│                                       pattern, ProductTabs.tsx:27-61)     │
│ Range: [24h|7d|30d|All ▾]                                                 │
│ ┌─────────────────────────────────────────────────────────────────────┐  │
│ │ 14:01  cart.add        Linen Shirt / L ×1            (activity)    │  │
│ │ 13:58  page.view       /products/linen-shirt         (activity)    │  │
│ │ 13:40  order.purchased AL-2026… ৳1,900   → link     (activity)    │  │
│ │ 11:02  auth.login      method=google                 (activity)    │  │
│ │ ── order history (from orders.statusHistory, labeled "order") ──    │  │
│ │ Sep 12  status  pending→processing  by Admin Y                     │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
│ ⚠ Viewing this timeline is recorded (admin.customer_viewed)              │
└──────────────────────────────────────────────────────────────────────────┘
```

Merge rule: **activity events** and **existing `orders.statusHistory`/`payment.verificationHistory`** are rendered as two labeled streams — never double-counted, never synthesized. If a date range predates tracking ("collected since &lt;date&gt;"), show that note instead of fake zeros.

### 3.4 Phase 3 additions (wireframe deltas only)

- **`/admin/activity/analytics` tab** (or section below feed): product table `Views | ATC% | Purchase% | Revenue` with date range; funnel bars `product.view → cart.add → checkout.started → order.purchased` with absolute counts + step conversion, missing data shown as `—` + "collected since …"; cart-abandonment card `Abandoned carts (24h+) | items | est. value`.
- Dashboard home (`AdminDashboard.tsx`) gains an "Activity" stat row **only after** Phase 4 proves stability.

---

## 4. Proposed API contracts

> All responses use existing envelopes: lists `{items, page, limit, total, totalPages}` (`API_DOCUMENTATION.md:7`); errors `{error:{code,message,details[]}}` (:9-10). All inputs Zod-validated.

### 4.1 Ingestion (public, optional auth)

**`POST /api/events`**

```
Middleware: apiRateLimiter → eventRateLimiter(60/min, userOrIpKey) → validateBody(eventBatchSchema)
Flag off  → 204 (no writes)
Auth      → cookie present ⇒ userId attributed server-side; absent ⇒ anonymous
```

```ts
// eventBatchSchema (server/src/schemas/activity.schema.ts)
{
  events: z.array(eventInputSchema).min(1).max(20)
}
eventInputSchema = z.object({
  eventId: z.uuid(),                          // dedup key
  type: z.enum([...closed list, §5.1...]),
  ts: z.date(),                               // clamped server-side
  anonymousId: z.string().max(36).regex(/^[a-zA-Z0-9-]{8,36}$/).optional(),
  sessionId:  z.string().max(36).regex(/^[a-zA-Z0-9-]{8,36}$/).optional(),
  path: z.string().max(200).optional(),       // normalized, no query
  productId: objectIdSchema.optional(),
  variantId: objectIdSchema.optional(),
  query: z.string().trim().max(100).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  referrerDomain: z.string().max(100).optional(),
  device: z.enum(['mobile','desktop','tablet']).optional(),
  meta: z.record(z.string().max(50), z.union([z.string().max(100), z.number(), z.boolean()])).optional(),
}).strip()                                    // userId NOT accepted — stripped if sent
```

**Response:** `202 { accepted: n, deduped: m }` — uniform; whole batch 400 `VALIDATION_ERROR` on schema failure (no per-event detail leak). Rate-limited → 429 `RATE_LIMITED` (existing shape, `rate-limit.ts:38-40`).

### 4.2 Admin reads (all inherit `adminRouter.use(requireAuth, requireRole('admin'))`, `admin.routes.ts:46`)

| Endpoint | Phase | Query schema (Zod, `admin.schema.ts` style) | Notes |
|---|---|---|---|
| `GET /api/admin/activity/live` | 2 | none | `{ visitors5m, cartsWithItems, openCheckouts, sessions: [{sessionId, userId?, path, lastTs}] (≤50), generatedAt, stale: boolean }` — reads events `ts > now-5m` |
| `GET /api/admin/activity/recent` | 2 | `type?`, `source?`, `userId?`, `from?`, `to?`, `page`, `limit≤50` | Global feed |
| `GET /api/admin/activity/customers/:id/timeline` | 2 | `from?`, `to?`, `types?`, `page`, `limit≤50` | Merges events + `orders.statusHistory`; **emits `admin.customer_viewed`** |
| `GET /api/admin/activity/overview` | 3 | `range: 24h\|7d\|30d` or `from`+`to` | Stat cards |
| `GET /api/admin/activity/products` | 3 | `productId?`, `range`/`from`,`to`, `page`, `limit` | Views/ATC/purchase/revenue |
| `GET /api/admin/activity/funnel` | 3 | `range`/`from`,`to`, `productId?` | Stage counts + step conversion |
| `GET /api/admin/activity/carts` | 3 | `minAgeHours` (default 24), `page`, `limit` | Abandoned-cart report |

**Consent endpoint (only if D1 option (b) or (c) needs it):**

| Endpoint | Phase | Purpose |
|---|---|---|
| `POST /api/users/me/tracking-consent` | 3 | `{ enabled: boolean }` — server-side consent record for authenticated users (body Zod-validated; updates `activity_consent` or user field per D1) |

### 4.3 What is deliberately NOT in the API

- No public event-read endpoint. No endpoint accepting `userId`. No endpoint returning IPs/UA (never stored). No WebSocket/SSE in MVP (30 s polling suffices at this scale).

---

## 5. Event taxonomy, identity, schema

### 5.1 Closed event-type enum

**A. Server-emitted (`source: 'server'`, authoritative):**

| type | Emitted from (exact) | Payload highlights |
|---|---|---|
| `auth.login` / `auth.register` / `auth.google_login` / `auth.logout` | `auth.controller.ts:16-49` / `auth.service.ts` | `method: password\|google` |
| `cart.add` / `cart.update` / `cart.remove` / `cart.clear` / `cart.merge` | `cart.service.ts:229/259/285/292/298` | `variantId`, `productId`, `quantity`, `value`(poisha, at add-time price) |
| `checkout.started` | `order.service.ts` pre-claim ~:338 | `checkoutId`, `itemCount` |
| `order.purchased` | `order.service.ts` **after** txn (:474+, before/after :481) | `orderId`, `orderNumber`, `total`(poisha), `paymentMethod`, `itemCount` |
| `order.cancelled` | `order.service.ts:534+`, `admin-order.service.ts:77+` | `orderId`, `by: customer\|admin` |
| `payment.claim_submitted` / `payment.claim_reviewed` / `payment.refunded` | `payment-claim.service.ts` post-txn (:235/:361/:550 finally windows) | ids + decision only — mirrors existing `verificationHistory`, no PII |
| `admin.order_status_changed` | `admin-order.service.ts:77-217` | `orderId`, `from`, `to` |
| `admin.product_created/updated/deleted`, `admin.variant_created/updated/deleted/restored` | `admin-catalog.service.ts` | ids |
| `admin.customer_viewed` | `activity.controller` timeline handler (NEW) | `adminId`, `customerId` — **customer-data access audit** |
| `admin.activity_exported` (future) | if CSV export ever added | filters used |

**B. Client-instrumented (`source: 'client'`, Phase 3, gated by D1):**

| type | Instrumentation point (§0.4) | Payload |
|---|---|---|
| `page.view` | tracker on `usePathname` change | `path`, `referrerDomain`, `device` |
| `product.view` | PDP mount (`app/products/[slug]/page.tsx` client parts) | `productId`, `slug` |
| `product.impression` | `ProductCard.tsx` grid render (batched, max 20/grid) | `productId`, `position` |
| `search.performed` | `Header.tsx:76-82`, `ProductsView.tsx:109-113` | `query`, `resultCount?` |
| `filter.applied` / `sort.changed` | `ProductFilters.tsx:48`, `ProductsView.tsx:115-117` | allowlisted keys only |
| `cart.checkout_clicked` | `CartPageClient.tsx:356-364,389-396` | `itemCount` |
| `checkout.viewed` | `CheckoutClient.tsx` mount | — |

**Never collected:** IP (rate-limiter memory only), raw user-agent (coarse `device` enum instead), keystrokes/mouse/clipboard, full referrer URLs (domain only), URL query strings (except structured `query`), email/phone/address in events.

### 5.2 Anonymous vs authenticated sessions & privacy-safe association

| Concept | Definition | Storage |
|---|---|---|
| `anonymousId` | Random UUID v4 generated once per browser, persisted | localStorage `al_anon_id` (pattern: `al_guest_cart`, `CartProvider.tsx:17`) |
| `sessionId` | Random UUID per tab session, rotates after 30 min idle | sessionStorage `al_session_id` |
| `userId` | **Server-only**, from verified JWT cookie | `activity_events.userId` (sparse) |
| Association rule | On login, events from that point carry both `userId` and `anonymousId` (linkage for funnel stitching). **No retroactive rewrite** of pre-login events; no cross-device merging. | §10 D8 |
| Withdrawal (logged-in) | Server stops accepting new events for that user (consent record) + optional purge of their events | per D1 |
| Withdrawal (anon) | Client deletes `al_anon_id` + stops tracker; prior events expire via TTL | per D1 |

### 5.3 Consent, withdrawal, retention, deletion

| Control | Design |
|---|---|
| **Baseline (P0)** | Server business events = operationally necessary (order/security facts, comparable to existing `statusHistory`); covered by **updated privacy notice** (`privacy/page.tsx`) stating what/why/how-long + contact for deletion. No banner required if owner accepts D1(a). |
| **Browse events (P1)** | Only enabled after D1. Options: (a) notice-only · (b) explicit opt-in banner before client tracker starts (default deny) · (c) browse events never collected. |
| **Withdrawal** | D1(b)/(c): client kill-switch (`NEXT_PUBLIC_ACTIVITY_TRACKING` + consent flag) + `POST /users/me/tracking-consent` server record honored by ingest (403/ignored for that identity). D1(a): withdrawal = contact form → admin/script purge. |
| **Retention** | TTL on `activity_events.ts` (§6); period = D2 (recommend **90 days**). Orders/users/carts retain their existing indefinite business retention — unaffected. |
| **Deletion** | Script `server/src/scripts/purge-activity.ts` (style of `set-role.ts`): by `userId`, by `anonymousId`, or by date; documented in privacy page. |
| **Data minimization enforced by** | Zod `.strip()` (no unknown fields), deny-list tests (§7), no PII fields in schema at all — events reference `userId` only, never embed profile data. |

### 5.4 Live visitor definition & freshness

| Parameter | Definition |
|---|---|
| **Active visitor** | A distinct `sessionId` with ≥1 event (any source) where `ts > now − 5 minutes` |
| **Freshness** | Admin UI polls `GET /admin/activity/live` every **30 s**; server queries only the last 5 minutes (index-backed). `generatedAt` returned; UI shows "updated Xs ago" |
| **Staleness** | If last successful poll > 90 s → show `stale: true` notice, keep last data |
| **Honesty labels (mandatory)** | UI must say: *"Approximate — counts visitors with activity in the last 5 minutes; closed tabs may linger, bots not filtered, not exact sessions."* Per `REQUIREMENTS.md:33-35` this number **must never** drive urgency/urgency-style messaging or stock claims |
| **Known approximations** | (i) beacon on unload may miss last-second events; (ii) clamped client `ts`; (iii) one user with two tabs = two sessions; (iv) server events (e.g. background cart ops) can occur without a "live" page |

### 5.5 MongoDB schema & indexes (planned — **not created in Phases 1–3**)

```ts
// server/src/models/activity-event.model.ts (new)
{
  eventId:     string;        // UUID — dedup key
  type:        enum;          // §5.1 closed list
  source:      'client' | 'server';
  ts:          Date;          // event time (clamped for client)
  userId?:     ObjectId;      // server-resolved only (sparse)
  anonymousId?: string;       // ≤36, only when no userId at time of event
  sessionId?:  string;        // ≤36
  path?:       string;        // normalized route pattern, no query string
  productId?:  ObjectId;
  variantId?:  ObjectId;
  orderId?:    ObjectId;      // server events only
  query?:      string;        // ≤100
  quantity?:   number;
  value?:      number;        // integer poisha (server events only)
  referrerDomain?: string;
  device?:     'mobile'|'desktop'|'tablet';
  meta?:       Record<string, string|number|boolean>;  // ≤3 keys, per-type allowlist
  createdAt:   Date;          // insert time — TTL target
}
```

**Expected indexes (creation deferred to Phase 4, owner-approved):**

| Index | Purpose |
|---|---|
| **unique** `{eventId: 1}` | Dedup on re-sends/batch retries |
| `{ts: 1}` + **TTL `expireAfterSeconds`** (= D2 seconds; recommend 90d = 7776000) | Retention; also serves live-window scans |
| `{type: 1, ts: -1}` | Feed filters, aggregations |
| `{userId: 1, ts: -1}` (sparse) | Customer timeline |
| `{sessionId: 1, ts: -1}` | Live visitor distinct-count |
| `{productId: 1, ts:-1}` | Product analytics |

**Degraded-mode requirement:** Phases 1–3 code must run **without** these indexes (dev `autoIndex` creates them locally; production starts index-less). Without unique `eventId`: app-level in-batch dedup only (documented degradation). Without `{sessionId,ts}`: live query slower but correct at MVP volume. **No existing index is modified or dropped, ever.**

**TTL notes:** Atlas TTL monitor deletes in background batches (~60 s granularity) — acceptable. TTL deletion failures are logged, not retried manually. Retention change later = index option change (owner-approved rollout).

### 5.6 Cart-abandonment definition (Phase 3)

| Element | Definition |
|---|---|
| **Abandoned cart** | A **server-side** cart (`carts` collection) with `items.length ≥ 1`, `checkoutInProgress: null`, `updatedAt < now − 24h`, and **no** `order.purchased` event (or order) by that user in the 24 h following `updatedAt` |
| **Scope** | Logged-in customers only. **Guest carts (localStorage) are invisible to the server** — report must state this limitation (§0.3) |
| **Value** | Sum of `value` recorded on that user's `cart.add` events not followed by purchase (event-sourced, avoids price-drift); fallback estimate from live variant prices **labeled "estimate"** |
| **Metrics** | `abandonedCount`, `itemsTotal`, `valueEstimate`, `recoveryRate` (carts later purchased within 48 h) |
| **Freshness** | Computed on read (indexed `carts.updatedAt` query) — no new collection needed at MVP volume |

### 5.7 Conversion funnel definition (Phase 3)

| Stage | Counting unit | Source |
|---|---|---|
| 1. View | distinct identity (`userId` else `sessionId`) with `product.view` in range | events |
| 2. Add-to-cart | identity with `cart.add` in range **after** a stage-1 view within 7-day attribution window | events |
| 3. Checkout started | identity with `checkout.started` after stage 2 | events (server) |
| 4. Purchased | identity with `order.purchased` after stage 3 | events (server) |

- Attribution window: **7 days**, identity-stitched per §5.2. Funnel is **approximate** (client stage 1 missing if D1(c) or tracker off; identity gaps pre-login) — UI shows collection-start date and "approximate" label.
- Product-level funnel adds `productId` filter (stage 1 by that product; later stages by matching `productId` in payload where available).

---

## 6. Privacy & security requirements (binding for all phases)

1. **Update `client/app/privacy/page.tsx` before any event is stored** (Phase 1): what/why/how-long, IP used only for rate limiting (not stored), first-party only/no ad networks, deletion contact.
2. **Deny-list fields** — `ip`, `userAgent`, `email`, `phone`, `address`, `password`, raw referrer URLs: absent from schema; enforced by `.strip()` + tests.
3. **Identity forgery** — client `userId` discarded (schema strip + service assert); anonymous events can never claim `userId`.
4. **Spam/flood** — `eventRateLimiter` 60/min per user-or-ip + existing global 300/min/IP; batch ≤20; whole-batch 400 on invalid schema.
5. **Admin authorization** — all reads behind router-level `requireAuth + requireRole('admin')` (`admin.routes.ts:46`); UI behind `RequireAdmin`; `objectIdSchema` params; no customer-facing event-read API exists at all.
6. **Customer-data access auditing** — every timeline fetch emits `admin.customer_viewed {adminId, customerId}` (itself an event, server-source) — "who watched the watchers". Feed shows admin actions already (`admin.*` types).
7. **Checkout isolation** — post-commit, fire-and-forget, never inside `withTransaction` (`order.service.ts:363` window; emit after :474).
8. **Path/query hygiene** — normalize to route allowlist; strip query strings (mirror `request-logger.ts:14`).
9. **Clock clamp** — client `ts ∈ [now−24h, now+5min]`; server events use server time.
10. **Error uniformity** — ingest 202/400/429 only; admin 404s generic (`admin-customer.service.ts:76` pattern).
11. **Untouched:** order snapshots, `checkoutId` idempotency, stock transactions, httpOnly cookie, open-redirect guard (`REQUIREMENTS.md:37`), existing unique indexes, payment providers.

---

## 7. Test strategy, fixtures, acceptance criteria, review gates

### 7.1 Test fixtures (new, in `server/test/`)

| Fixture | Purpose |
|---|---|
| `helpers/activity.ts` — `makeEvent(overrides)`, `makeBatch(n)`, `seedEvents(docs)` | Deterministic UUIDs, clamped ts, closed-enum types |
| Consent fixture (D1b) — `withConsent(userId, enabled)` | Ingest honoring test |
| `flagOff()` env fixture | `ACTIVITY_EVENTS_ENABLED=false` behavior |

### 7.2 Automated tests (Phase 1 gate = these must pass)

| # | Test | File (planned) |
|---|---|---|
| T1 | Schema: batch cap 20; unknown type rejected; **`ip`/`userAgent`/`email`/`userId` stripped**; `meta` ≤3 keys; ts clamp; integer poisha only | `activity-schema.test.ts` |
| T2 | Ingest: duplicate `eventId` → deduped, one doc; anonymous OK; cookie ⇒ `userId`; **spoofed client userId ignored** | `activity-ingest.test.ts` (db) |
| T3 | Authz: `/admin/activity/*` → 401 no cookie, 403 `role:'customer'`, 200 admin; timeline `:id` valid/invalid ObjectId | `activity-authz.test.ts` (db) |
| T4 | Rate limit: request 61/min → 429 `RATE_LIMITED` | `activity-rate-limit.test.ts` |
| T5 | **Checkout non-blocking**: stub activity insert to reject → `createOrder` still succeeds, order exists, stock correct | `checkout-not-blocked.test.ts` (db) |
| T6 | Flag off: ingest → 204, zero documents written; emitters no-op | `activity-flag.test.ts` (db) |
| T7 | Access audit: timeline GET emits `admin.customer_viewed` with correct `adminId` | `activity-authz.test.ts` |
| T8 | Regressions: all 9 existing server suites pass untouched | existing |
| T9 | Client: queue batches at 10 events/5 s; beacon on `hidden`; flag off ⇒ zero network; 429/5xx dropped silently (no UI noise) | `client/lib/__tests__/tracking-queue.test.ts` |
| T10 | Browser: PDP add-to-cart works with tracker mounted | `npm run test:browser` |

### 7.3 Acceptance criteria per phase (staging, manual)

| Phase | Criteria |
|---|---|
| **1** | Flag off ⇒ zero new writes/calls, full regression green (`type-check`, `lint`, 83+35+7 tests). Flag on (staging) ⇒ login/add-to-cart/purchase each appear **exactly once**; replayed batch dedups; privacy page updated; PII spot-check on staging docs finds deny-listed fields nowhere |
| **2** | Live panel updates ≤35 s with correct approximate count; feed filters (type/date) work; timeline merges streams with labels; `admin.customer_viewed` recorded; all loading/error/empty states present; 401/403/200 matrix verified |
| **3** | Product table numbers reconcile with known staging orders (±attribution); funnel step math verified by hand on a seeded fixture; abandoned-cart query matches manual `carts` query; consent withdrawal (per D1) stops ingest for that identity |
| **4** | Independent reviewer runs §7.2 suite + §7.4 checklist; index rollout executed with recorded rollback target; flag staged on; rollback drill (flag off) demonstrated ≤5 min |

### 7.4 Independent review gates (Phase 4)

- **G1 — Code review:** diff confined to Appendix A file list; no edits to `order.model.ts` indexes, `middleware/auth.ts` semantics, existing tests' assertions.
- **G2 — Privacy review:** deny-list test green; privacy page matches actual fields (field-by-field walkthrough).
- **G3 — Security review:** authz matrix, spoof/dedup/rate-limit tests green; no new public read surface.
- **G4 — Ops review:** flag-off rollback drill; index rollout plan with rollback target recorded first (precedent `PAYMENT_INDEX_MIGRATION_PLAN.md:149`); health endpoint unchanged.
- **G5 — Product review:** live-count labels honest (§5.4); no fabricated urgency anywhere (`REQUIREMENTS.md:33-35`).

Each gate = explicit owner sign-off before the next proceeds. **No phase's commits merge past its gate without sign-off.**

---

## 8. Performance, storage budget, failure isolation

| Concern | Control |
|---|---|
| **Write path** | One `insertMany(ordered:false)` per batch (≤20); no transactions; no references resolved (ids stored raw) |
| **Failure isolation** | Entire ingest wrapped in try/catch → never throws to Express request path; emitters use `void service.emit(...).catch(() => {})`; live/feed queries time-boxed (`maxTimeMS` 2s) |
| **Checkout performance** | Emission strictly post-commit; T5 test enforces; zero added latency on stock/order writes |
| **Read path** | Live query = last 5 min only (covered by `{ts}` index); feed = `{type,ts}` range + limit ≤50; timeline = `{userId,ts}`; aggregation endpoints Phase 3 with `range` caps |
| **Rate limiting** | `eventRateLimiter` 60/min/user-or-ip (new) + global 300/min/IP; admin reads ride existing global limiter |
| **Flag isolation** | `ACTIVITY_EVENTS_ENABLED=false` ⇒ zero writes, zero query cost — instant kill switch |
| **Storage budget (ASSUMPTION — U1)** | 500 visits/day × ~10 events (P1 scope) ≈ 5k events/day ≈ ~400 B/doc ⇒ **~0.7 GB/yr raw; ~150–250 MB steady-state at 90-day TTL**. P0-only (server events): <20 MB/90 d. Quarterly review of `collStats` (documented in ops notes, not automated) |
| **Growth guardrails** | Batch cap, rate limit, closed enum, TTL; if daily inserts ever exceed ~50k (ASSUMPTION threshold), introduce sampling for `page.view`/`product.impression` + rollups (P2, not scheduled) |
| **Single-instance limits** | In-memory rate limiter resets on deploy/restart (known finding B6, `AUDIT_REPORT.md:126`) — acceptable; events are best-effort |
| **Query timeouts** | Any analytics query > 2 s ⇒ return partial + `stale:true` rather than blocking the admin UI |

---

## 9. Implementation sequence — phases with file candidates, dependencies, acceptance, migration, commit boundaries

> **Global preconditions:** (a) owner approves this document (Phase 0 exit); (b) dirty working tree settled (§10 D7); (c) no new dependencies in any phase; (d) every phase = **one PR / one review boundary**, merged only after its acceptance criteria + relevant gates pass. Commits/pushes/merges require explicit owner authorization each time (standing rules).

### Phase 0 — Read-only audit & design approval ✅ (this document)

- **Deliverable:** this plan. **Code:** none. **Migration:** none.
- **Exit gate:** owner signs off D1–D8 (§10) and accepts architecture.

### Phase 1 — Tracking foundation + security/privacy tests

| | |
|---|---|
| **Goal** | Ingest pipeline, server emitters, flag, privacy copy — all shipped **disabled** |
| **New files** | `server/src/models/activity-event.model.ts` · `server/src/schemas/activity.schema.ts` · `server/src/services/activity.service.ts` · `server/src/controllers/event.controller.ts` · `server/src/routes/event.routes.ts` · `server/test/helpers/activity.ts` · `server/test/activity-{schema,ingest,authz,rate-limit,flag,checkout-not-blocked}.test.ts` |
| **Edited files** | `server/src/routes/index.ts` (mount `/events`, +1 import/use) · `server/src/middleware/rate-limit.ts` (+`eventRateLimiter`) · `server/src/config/env.ts` (+`ACTIVITY_EVENTS_ENABLED` default false) · `server/.env.example` (+documented var) · `server/src/controllers/auth.controller.ts` (auth.* emit) · `server/src/services/cart.service.ts` (cart.* emit) · `server/src/services/order.service.ts` (checkout.started ~:338; order.purchased **after :474**; order.cancelled post-txn) · `server/src/services/admin-order.service.ts` + `payment-claim.service.ts` + `admin-catalog.service.ts` (admin.*/payment.* emits, post-txn) · `client/app/privacy/page.tsx` (disclosure) |
| **Dependencies** | Phase 0 approval; D1 baseline (notice-only acceptable for server events); D2 retention (TTL value recorded but **index not created**) |
| **Acceptance** | §7.3 Phase 1; `npm run type-check` + `npm run lint` (root) clean; flag-off = zero behavioral change |
| **Migration** | **None to existing data.** New collection created implicitly on first write (dev) — production collection appears on flag-on; no schema migrations; **no indexes created** (degraded-mode per §5.5) |
| **Commit/review boundary** | **PR-1: "activity tracking foundation (flagged off)"** — single review; G1+G2+G3 partial (code+schema+tests); merge ≠ release (flag stays off) |

### Phase 2 — Live dashboard + customer timeline MVP

| | |
|---|---|
| **Goal** | Capability 1 + 2: live monitoring, feed, customer timeline, date filters, access audit |
| **New files** | `server/src/services/admin-activity.service.ts` · `server/src/controllers/admin-activity.controller.ts` · `server/src/routes/admin-activity.routes.ts` (mounted inside `adminRouter`) · `server/src/schemas/admin.schema.ts` edits (activity query schemas) · `client/app/admin/activity/page.tsx` · `client/app/admin/customers/page.tsx` · `client/app/admin/customers/[id]/page.tsx` · `client/components/admin/ActivityOverview.tsx` · `LiveVisitorsPanel.tsx` · `ActivityFeed.tsx` · `CustomerList.tsx` · `CustomerTimeline.tsx` · `client/lib/__tests__/` feed-filter tests |
| **Edited files** | `server/src/routes/admin.routes.ts` (+GET routes before/at customers section :100-106) · `client/components/admin/AdminShell.tsx` (+2 NAV_ITEMS) · `client/lib/api/admin.ts` (+read methods) · `client/lib/types/admin.ts` (+DTO types) |
| **Dependencies** | Phase 1 merged; flag can be turned **on in staging only**; D2 (display "collected since" dates) |
| **Acceptance** | §7.3 Phase 2; G1 review; wireframe §3.2–3.3 matched incl. loading/error/empty + approximate-labels |
| **Migration** | None. Optional: none to existing collections |
| **Commit/review boundary** | **PR-2: "activity center admin UI + live/timeline reads"** — separate from PR-1; requires Phase 1 acceptance sign-off first |

### Phase 3 — Product, cart, search & conversion analytics (Capability 3)

| | |
|---|---|
| **Goal** | Browse events, product analytics, funnel, cart abandonment, consent withdrawal (per D1) |
| **New files** | `client/lib/api/tracking.ts` · `client/components/providers/ActivityTracker.tsx` · `client/lib/__tests__/tracking-queue.test.ts` · server: `admin-activity` analytics handlers (products/funnel/carts/overview) · `client/components/admin/ActivityAnalytics.tsx` (+ sections in ActivityOverview) · consent endpoint/schema only if D1 requires |
| **Edited files** | `client/components/providers/Providers.tsx` (+tracker child) · instrumentation: `PurchasePanel.tsx:107`, `CartProvider.tsx:139-207`, `CartPageClient.tsx:356/389`, `ProductsView.tsx:109-121`, `Header.tsx:76-82`, `ProductCard.tsx:26`, `CheckoutClient.tsx:279` (view-only; purchase stays server-side) · `server/src/config/env.ts` (+`NEXT_PUBLIC` client flag is client-side `.env.example`) · `client/.env.example` |
| **Dependencies** | D1 must permit browse collection (else P1-2/3 degrade to server-funnel-only — noted in UI); Phase 2 accepted |
| **Acceptance** | §7.3 Phase 3; T9/T10 green; funnel math hand-verified on fixture |
| **Migration** | None to existing data; if D1(b): new `activity_consent` collection (net-new) |
| **Commit/review boundary** | **PR-3: "browse instrumentation + growth analytics"** — can split into PR-3a (tracker+page/product/search) and PR-3b (funnel+abandonment+analytics UI) if review size demands; each needs Phase 2 sign-off |

### Phase 4 — Independent verification & controlled release

| | |
|---|---|
| **Goal** | Gates G1–G5, index rollout, staged flag-on, rollback drill |
| **Activities** | Independent reviewer re-runs full suites (`server npm test`, `client npm test`, `test:browser`, root type-check/lint) · privacy field spot-check on staging · load smoke (burst of 500 batches) · **index rollout** (separate owner authorization; record current production deployment as rollback target FIRST — `PAYMENT_INDEX_MAGRATION_PLAN.md:149` precedent; verify via status script-style check) · TTL activation confirmation · staged release: staging flag-on 48 h → production flag-on → monitor error rates/429s/storage · rollback drill: flag-off + verify ≤5 min |
| **Files** | Possibly `server/src/scripts/activity-index.ts` (status/apply/rollback tooling mirroring `payment-index.ts`) — **script exists but applying to production requires separate authorization** |
| **Dependencies** | Phases 1–3 merged; all G-gates schedulable |
| **Acceptance** | §7.3 Phase 4; G1–G5 signed; rollback drill evidenced |
| **Migration** | **Index creation happens here only**, never before; no document backfill required (events are forward-only) |
| **Commit/review boundary** | **PR-4: "release tooling + docs"** (scripts/notes only) · production index rollout = **separate authorization event**, not a code merge · flag-on = **separate deployment authorization** |

**Phase dependency graph:** `0 → 1 → 2 → 3 → 4` (3 may start after 2's sign-off; 4 requires 1–3). No phase parallelizes across the PR boundaries without owner approval.

---

## 10. Operational risks & owner decisions

### 10.1 Risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Excessive personal information in events | High | No PII fields in schema; deny-list tests (T1); privacy walkthrough (G2) |
| R2 | Forged identity / event spam | High | Cookie-only userId; unique `eventId`; rate limits; closed enum; batch caps |
| R3 | Unauthorized customer-data access | High | Router-level admin guard (existing); **new** `admin.customer_viewed` audit; no customer read API |
| R4 | High-volume writes hurting checkout | High | Post-commit fire-and-forget; T5 test; flag kill switch; rate limits |
| R5 | Breaking MongoDB unique-index/transaction guarantees | High | Net-new collection only; indexes deferred & separately approved; degraded-mode requirement; no edits to existing schemas/indexes |
| R6 | Misreading approximate live counts | Medium | Mandatory UI labels (§5.4); never for urgency/stock claims (REQUIREMENTS) |
| R7 | Storage growth | Medium | TTL (D2), batch/rate caps, budget review, sampling escape hatch (§8) |
| R8 | Production deploy/rollback failure | Medium | Flag-first; PR boundaries; recorded rollback target before index rollout; ≤5 min flag-off drill |
| R9 | Dirty working tree contaminates implementation | Medium | D7 precondition; re-verify `git status` before Phase 1 |
| R10 | Client events without consent (regulatory/owner surprise) | Medium | D1 gate before Phase 3; default-deny if unsettled |
| R11 | In-memory limiter resets on deploy (existing B6) | Low | Accepted; events best-effort |
| R12 | Guest-cart blind spot misread as "no abandonment" | Low | Report states logged-in-only scope explicitly (§5.6) |

### 10.2 Owner decisions required (Phase 0 exit)

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Consent model | (a) privacy-notice-only, first-party, no banner · (b) opt-in banner before client events · (c) no client browse events ever | **(a)** for server events regardless; for browse events **(a)** if owner accepts first-party posture, else **(c)** — must be settled before Phase 3 |
| **D2** | Retention | 30 / 90 / 180 days | **90 days** TTL |
| **D3** | IP handling | (a) never persist · (b) truncated for forensics | **(a)** |
| **D4** | Phase 3 scope if D1=c | server-funnel only vs skip Phase 3 analytics | server-funnel only (view stage shown as "unavailable") |
| **D5** | Live count | build / defer / never | **Build in Phase 2** with mandatory labels; never for urgency |
| **D6** | Index rollout procedure | (a) payment-index-style script + recorded rollback target · (b) manual Atlas with owner online | **(a)** |
| **D7** | When to start given dirty tree | (a) settle current work first · (b) branch over mixed state | **(a)** — 70 uncommitted entries unsafe to reason over |
| **D8** | Anon↔user linkage | store both & stitch forward (recommended) vs strict separation | **Stitch forward from login; no retroactive rewrite** |

---

## 11. Recommended first implementation task

> **Task P0-1 (start of Phase 1), once Phase 0 is approved and D7 cleared:**

**Create the event foundation module — server only, flag off:**

1. `server/src/models/activity-event.model.ts` — schema per §5.5 (**no `.index()` calls for production-sensitive indexes except a dev-friendly unique `eventId`**; document that TTL/compound indexes are Phase 4).
2. `server/src/schemas/activity.schema.ts` — `eventInputSchema` + `eventBatchSchema` per §4.1 (`.strip()`, closed enum, no `userId` field).
3. `server/src/services/activity.service.ts` — `ingest(events, ctx)` with identity rules (§5.2), ts clamp, in-batch dedup, `insertMany(ordered:false)` + E11000 tolerance, **all errors swallowed**; `emit(serverEvent)` helper for emitters.
4. Wire `POST /api/events` (`event.routes.ts` → `routes/index.ts`) + `eventRateLimiter` (`rate-limit.ts`) + `ACTIVITY_EVENTS_ENABLED` flag (`config/env.ts`, `.env.example`).
5. Tests T1, T2, T4, T6 + fixtures (§7.1).

**Why this first:** it is the smallest independently testable unit, unlocks both server emitters (rest of Phase 1) and every later phase, ships with zero behavior change (flag off), and immediately proves the privacy/spoof/dedup guarantees the whole system rests on. No client code, no admin UI, no indexes, no migration.

**Verify with:** `cd server; npm run type-check; npm run lint; npm test` (new tests + all existing green).

---

## Appendix A — Complete file-change map (nothing created now)

**New (all phases):** listed per phase in §9.

**Edited (targeted edits only):** `routes/index.ts`, `routes/admin.routes.ts`, `middleware/rate-limit.ts`, `config/env.ts`, `.env.example` (both), `controllers/auth.controller.ts`, `services/{cart,order,admin-order,payment-claim,admin-catalog}.service.ts`, `schemas/admin.schema.ts`, `client/app/privacy/page.tsx`, `client/components/providers/Providers.tsx`, `client/components/admin/AdminShell.tsx`, `client/lib/api/admin.ts`, `client/lib/types/admin.ts`, instrumentation points §5.1-B.

**Explicitly untouched:** `order.model.ts` indexes & snapshots, `cart.model.ts`, `user.model.ts` (unless D1 forces a consent field — then Phase 3 with migration note), `middleware/auth.ts` semantics, `request-logger.ts`, `middleware/validate.ts`, payment provider config/activation, all existing test assertions, existing unique/partial indexes.

---

## Appendix B — Commands run during this audit (read-only)

```
Get-ChildItem -Force (repo root)
Read: REQUIREMENTS.md, PROJECT_CONTEXT.md, AGENTS.md (standing rules)
Explore agent: server/src tree, routes, models, middleware, services, schemas, tests, package.json
Explore agent: client/app, components, lib, package.json, next.config.ts patterns
Explore agent: API_DOCUMENTATION.md, DATABASE_SCHEMA.md, DEPLOYMENT.md, ROADMAP.md,
               AUDIT_*.md, PAYMENT_INDEX_MIGRATION_PLAN.md, .env.example files, git status/log
Read: admin-customer.service.ts, privacy/page.tsx, Providers.tsx, AdminShell.tsx,
      request-logger.ts, rate-limit.ts, app.ts, admin.schema.ts, cart.model.ts,
      routes/index.ts, routes/admin.routes.ts
Grep: consent|opt-out|cookie banner|tracking (repo-wide) → no source hits
Grep: handleAddToCart|orderApi.create|justPlaced; NAV_ITEMS|listOrders;
      withTransaction|onOrderPlaced; API_RATE_LIMIT|TRUST_PROXY
```

No files were modified other than this plan document. No indexes, dependencies, commits, pushes, merges, deployments, or payment-provider activations occurred. Existing branches, worktrees and untracked files preserved.

---

*End of Phase 0 plan — stopped for owner review.*
