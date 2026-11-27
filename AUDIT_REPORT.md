# Audit Report — Abstract Lifestyle

**Repository:** `mahimrahman659-sudo/Abstract-Lifestyle` (audited on branch `main`, commit `f39ac2a`)
**Audited by:** Cline
**Method:** full source read of every server and client module, plus targeted automated scans (Appendix A).
**Production check:** read-only verification against `https://abstract-lifestyle.vercel.app` — no writes to the production database.
**Result:** 6 blockers · 8 high · 14 medium · 14 low = **42 findings**.

---

## 0. How to read this report

Each finding has an ID (`A1`, `B3`, `C7`, `D2`…), a severity, a location, a **root cause**, the user/business impact, an architecture-aligned fix, and the regression test that would prove the fix.

| Severity | Meaning |
|---|---|
| **A — Blocker** | Silent data corruption, a broken primary flow in a supported environment, or content/SEO that is wrong in production. Fix before the next deploy. |
| **B — High** | A real defect in a normal user or admin flow — users hit it without doing anything unusual. |
| **C — Medium** | Correctness/a11y/UX defect with a narrower blast radius, or a performance characteristic that hurts the stated audience (mobile shoppers in Bangladesh). |
| **D — Low** | Polish, consistency, documentation drift, maintainability. |

---

## 1. Executive summary

The architecture is sound and the code is unusually disciplined for an MVP: money is integer poisha everywhere, totals and stock are server-authoritative, orders are snapshotted, checkout is idempotent, auth uses an httpOnly cookie with server-side role checks, and every input is Zod-validated. Nothing in the security core is broken.

Risk concentrates in four places:

1. **Deployment assumptions vs. code.** Checkout and cancellation use MongoDB transactions (replica set required), while `PROJECT_CONTEXT.md` and `server/.env.example` describe standalone Mongo. Production (Atlas) works; the documented local/self-hosted setup does not.
2. **Order/stock integrity edge cases.** Deleting a variant that appears in an order silently destroys the ability to restore that stock on cancellation, and cart writes are not blocked during checkout, so items added mid-checkout can be dropped.
3. **Admin workflow completeness.** There is no way to find an order by phone number or order number — the exact lookup the COD-confirmation workflow depends on.
4. **Customer account completeness.** Profile editing and address edit/delete exist on the server but have no UI, so a wrong delivery address can only be fixed by placing a new order.

## 2. Findings — A. Blockers

### A1 — Transactions require a replica set, but the project documents standalone Mongo
- **Area:** order processing / deployment
- **Location:** `server/src/services/order.service.ts` (`createOrder`, `cancelOrder`), `server/src/services/admin-order.service.ts` (`adminUpdateOrderStatus`); `PROJECT_CONTEXT.md` §6/§9; `server/.env.example`
- **Root cause:** the stock/order implementation was upgraded to multi-document transactions without updating the documented decision ("no transactions — works on standalone Mongo") or the sample connection string (`mongodb://127.0.0.1:27017/...`, standalone by default).
- **Impact:** on a standalone MongoDB, `session.withTransaction()` throws *"Transaction numbers are only allowed on a replica set member or mongos"* → **every checkout and every cancellation returns 500**. Atlas (replica set) is unaffected, so the defect only appears for new developers/self-hosting — exactly where it is hardest to diagnose.
- **Fix:** choose one and make the repo consistent:
  1. *Keep transactions* (recommended — correctness is better): document a single-node replica set (`mongod --replSet rs0` + `rs.initiate()`), update `.env.example`, `DEPLOYMENT.md` and PROJECT_CONTEXT §6/§9 with the real decision and rationale.
  2. *Drop transactions*: restore guarded `findOneAndUpdate` + compensating rollback, and accept the documented small race window.
- **Test:** integration test running `createOrder`/`cancelOrder` against the configured Mongo, asserting success and exact stock deltas; a startup check that fails when the deployment expects transactions but the connection is not a replica set.

### A2 — Profile editing and address management are missing from the UI
- **Area:** account / requirements gap
- **Location:** `client/components/auth/AccountPanel.tsx` ("Profile editing and address management ship in a later release"), `client/lib/api/user.ts` (only `getAddresses`, `createAddress`); unused server endpoints `PATCH /users/me`, `PATCH/DELETE /users/me/addresses/:id` in `server/src/routes/user.routes.ts`
- **Root cause:** the account slice was scoped down during UI work; the server half was already built.
- **Impact:** a customer cannot correct their name, fix a typo in an address, delete an old address, or change the default. Checkout auto-selects the default address, so a stale default sends orders to the wrong place. `PROJECT_CONTEXT.md` §3 lists "profile, saved addresses" as must-have.
- **Fix:** add the three client wrappers (`updateProfile`, `patchAddress`, `deleteAddress`), a profile form, and an address list with edit/delete/set-default. Reuse `AddressForm` + `validateAddress`; mirror the server Zod rules.
- **Test:** component test for default-switching (exactly one default) and delete-default behaviour; contract tests for the four endpoints.

### A3 — Placeholder content is live in production
- **Area:** storefront content
- **Location:** `client/config/site.ts` — `socials` (three `href: '#'`), `contact.email: 'hello@example.com'`, `contact.hours`, trust/checkout copy marked "OWNER: confirm"
- **Root cause:** copy is centralised (good) but the owner-confirmation items were never resolved before deploy.
- **Impact:** footer social icons jump to the top of the page; the contact page advertises a non-existent email; unverified operational claims ("we will call you…") are shown to shoppers.
- **Fix:** replace with real values, or omit items while unset (render the social list only with real URLs). Add a production-build check that fails on `#` social URLs or `example.com`.
- **Test:** unit assertion that `site.socials.every(s => s.href !== '#')` and the contact email is not on `example.com` when `NODE_ENV === 'production'`.

### A4 — `NEXT_PUBLIC_SITE_URL` silently falls back to localhost
- **Area:** SEO / deployment
- **Location:** `client/lib/seo.ts` (`new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')`)
- **Root cause:** developer-friendly default with no production guard.
- **Impact:** if the variable is missing on Vercel, `metadataBase`, every canonical URL, OpenGraph URLs, the `robots.txt` sitemap line and all `sitemap.xml` entries point at `http://localhost:3000`. Search engines receive unusable URLs; shared product links produce broken previews. Failure is silent.
- **Fix:** throw at module load when `NODE_ENV === 'production'` and the value is absent or localhost (or derive from `VERCEL_PROJECT_PRODUCTION_URL` as a documented fallback).
- **Test:** unit test on the URL resolver for unset / localhost / valid, in production and development.

### A5 — Deleting a variant used by an order destroys stock restoration
- **Area:** order integrity / inventory
- **Location:** `server/src/services/admin-catalog.service.ts` → `deleteVariant` (only checks that a sibling remains); restore paths `server/src/services/order.service.ts` (`cancelOrder`) and `server/src/services/admin-order.service.ts` (`adminUpdateOrderStatus` → `cancelled`) increment stock by variant id.
- **Root cause:** `deleteProduct` guards against products referenced by orders, but the same guard was never applied at the variant level — even though variants are the stock-bearing entity.
- **Impact:** delete a variant a `pending` order bought → cancelling that order runs `$inc` on a non-existent document (no-op, no error) → units are never restored. Inventory drifts low forever and nothing reports it.
- **Fix:** in `deleteVariant`, block when `OrderModel.exists({ 'items.variant': variantId })` (409 with an explanation), or convert delete into an archived/inactive flag for referenced variants. Return the count so the UI can explain it (same pattern as product archive).
- **Test:** integration test — order a variant, attempt delete (expect 409), cancel the order, assert stock restored exactly.

### A6 — Seed script uses a weaker bcrypt cost and creates publish-invalid products
- **Area:** scripts / data integrity
- **Location:** `server/src/scripts/seed.ts` (`bcrypt.hash(env.ADMIN_PASSWORD, 10)`; products upserted with no `images` but `status: 'active'`)
- **Root cause:** the seed predates `BCRYPT_COST = 12` in `auth.service.ts` and the new publish rule (≥1 variant + ≥1 image).
- **Impact:** the highest-privilege account is hashed with a weaker cost than every other account; seeded products violate the invariant the admin UI now enforces, so they render placeholders and cannot be re-saved as `active` without images.
- **Fix:** export one `BCRYPT_COST` from shared config and use it in both places; seed demo images (or seed `draft` and let the operator publish).
- **Test:** assertion that seed and auth reference the same constant; integration check that seeded `active` products satisfy the publish rule.

---

## 3. Findings — B. High

### B1 — Items added during checkout can be silently lost
- **Location:** `server/src/services/order.service.ts` (`createOrder`: claim → build from pre-claim `cart.items` → `$set: { items: [] }`), `server/src/services/cart.service.ts` (`addItem`, `updateItem`, `removeItem`, `mergeGuestItems` — none check `checkoutInProgress`)
- **Root cause:** the checkout claim protects against a second *checkout*, not against cart *mutations*.
- **Impact:** shopper opens checkout, then adds an item in another tab (or on a second device): the order is created from the stale snapshot and the clear wipes the new line. The shopper loses an item they just chose, with no message.
- **Fix:** re-read the cart inside the transaction and build items from that read; reject/queue cart writes while a non-stale claim exists (409 "checkout in progress") so the client can retry after it clears.
- **Test:** concurrency test — start `createOrder`, add an item mid-flight, assert the new item survives (or the request is rejected) and no quantity vanishes.

### B2 — First-cart creation can 500 on a race
- **Location:** `server/src/services/cart.service.ts` → `getOrCreateCart` (`findOneAndUpdate({user}, {$setOnInsert…}, {upsert:true})` against a unique index on `user`)
- **Root cause:** upsert-on-unique-key is not atomic against concurrent inserts; Mongoose does not retry E11000.
- **Impact:** a brand-new user double-clicking "Add to cart" (or two tabs on first visit) gets "Internal server error"; one request succeeds, the other fails visibly.
- **Fix:** catch code `11000` and re-run the plain `findOne({user})` once (idempotent).
- **Test:** parallel `getCart` calls for a fresh user → both 200, exactly one cart document.

### B3 — Checkout accepts carts containing unavailable/out-of-stock lines
- **Location:** `client/components/checkout/CheckoutClient.tsx` (summary renders `lineTotal ?? 0`; `onSubmit` never inspects `unavailable/outOfStock/insufficientStock`), versus `client/components/cart/CartPageClient.tsx`, which does block
- **Root cause:** the guard lives only on the cart page; checkout is reachable directly (history, bookmark, back button).
- **Impact:** the order summary shows phantom ৳0 lines and submit fails with a generic 409 after a round-trip, instead of naming the line to fix. Bad on a phone.
- **Fix:** extract the blocker logic into one shared helper used by both pages; disable place-order and list the specific lines needing attention.
- **Test:** component test — cart with one unavailable line → submit disabled, reasons listed.

### B4 — Guest cart page performs N+1 over HTTP
- **Location:** `client/lib/cart/guest-lines.ts` → `getProducts({limit: 50})` then one `getProduct(slug)` per card
- **Root cause:** no public endpoint resolves a set of variant ids.
- **Impact:** up to **51 API requests** to render a guest cart — seconds on 3G, and it burns the global 300 req/min per-IP budget (three refreshes can rate-limit the shopper out).
- **Fix:** add `GET /api/products/variants?ids=…` (or include `variants[]` with ids/prices in the list payload) and resolve the guest cart in one call.
- **Test:** batch-endpoint integration test (N ids → N results, unknown ids skipped) plus a client test asserting one request.

### B5 — Header active state goes stale after query-only navigation
- **Location:** `client/components/layout/Header.tsx` — `queryString` is refreshed only when `pathname` changes
- **Root cause:** `useSearchParams` was avoided to keep pages static; the replacement only listens to pathname.
- **Impact:** changing sort/filters (`/products?category=bags`) leaves the previous nav item highlighted; "Shop" vs category indicators lie.
- **Fix:** read `useSearchParams()` inside a small Suspense-wrapped client child, or subscribe to `popstate`/`pushState`.
- **Test:** navigate to `/products?category=bags` → the matching entry has `aria-current="page"`.

### B6 — Rate limiting is per-process, in memory
- **Location:** `server/src/middleware/rate-limit.ts` (default MemoryStore)
- **Root cause:** an in-memory store suits a single instance; the deployment can scale/restart.
- **Impact:** with N instances the real limits are N×; a restart resets counters. Login/register brute-force protection is weaker than documented, and the same applies to checkout/upload limits.
- **Fix:** document the single-instance assumption explicitly, or back the store with Mongo/Redis (one small adapter) before scaling out.
- **Test:** integration test with two app instances sharing a store (or an assertion that the store is not memory in production).

### B7 — Customer cancellation rule contradicts the spec
- **Location:** `server/src/services/order.service.ts` → `cancelOrder` filters `status: 'pending'`; `PROJECT_CONTEXT.md` §3 says "cancel (pending/processing only)"; `API_DOCUMENTATION.md` says "only from `pending`"
- **Root cause:** behaviour changed during implementation; one of the three documents was not updated.
- **Impact:** a shopper who calls to cancel while the order is `processing` cannot; support must do it manually. Either the product promise or the code is wrong.
- **Fix:** decide the rule. If `processing` must be cancellable for customers, extend the filter and keep the same guarded update; otherwise correct PROJECT_CONTEXT §3.
- **Test:** parameterised test over statuses × actor (customer/admin) asserting the allowed matrix.

### B8 — Admins cannot find an order by phone number or order number
- **Location:** `server/src/schemas/admin.schema.ts` → `adminOrderQuerySchema` (only `status`, `page`, `limit`); `server/src/services/admin-order.service.ts` → `adminListOrders` (no search); `client/components/admin/AdminOrders.tsx` (status filter only); `server/src/models/order.model.ts` (no index on `shippingAddress.phone`)
- **Root cause:** the admin order list was built as a status-filtered feed; the documented user need ("admin staff confirm COD orders by phone") implies lookup, not scrolling.
- **Impact:** with more than a page or two of orders, confirming an incoming call means paging through the feed. This is the single most-used admin action in the product's own description.
- **Fix:** add `?search=` matching `orderNumber` (exact/prefix) and `shippingAddress.phone` (normalized), plus `phone` in customer search; add a compound index (`shippingAddress.phone`, `createdAt`) and use it. Add a search box in the list (pre-fillable from a tapped phone).
- **Test:** integration tests for search by order number, by full/partial phone, and by customer email; index-usage assertion via `explain()`.

---

## 4. Findings — C. Medium

### C1 — Duplicate DOM id `confirm-title`
- **Location:** `client/components/admin/ConfirmDialog.tsx` (hard-coded `id="confirm-title"`), rendered twice in `client/components/admin/ProductEdit.tsx` (archive + delete)
- **Root cause:** static id in a reusable component.
- **Impact:** invalid HTML; both dialogs' `aria-labelledby` resolve to the first heading, so the delete confirmation can be announced as "Archive product?".
- **Fix:** `const titleId = useId()`.
- **Test:** render two dialogs, assert unique ids and correct accessible names.

### C2 — Mobile menu has no focus trap, scroll lock, or Escape
- **Location:** `client/components/layout/Header.tsx` (mobile panel is a `div` toggled `hidden`/`block`)
- **Root cause:** the panel was built as a disclosure, not a modal surface.
- **Impact:** background scrolls behind it on phones, focus escapes to hidden content, Escape does nothing — the most-used mobile surface is the least accessible one.
- **Fix:** Escape handling + `overflow-hidden` on `body` while open + focus move/return (or reuse the native `<dialog>` pattern already used elsewhere).
- **Test:** keyboard test — Tab cycles inside the panel; Escape closes and restores focus.

### C3 — Compare-at price is hidden from screen readers
- **Location:** `client/components/catalog/ProductCard.tsx` — `<s aria-label="Original price">৳1,890</s>`
- **Root cause:** the label replaces the content instead of describing it.
- **Impact:** assistive tech announces "Original price" with no value — the discount badge is meaningless.
- **Fix:** include the amount in the accessible name (or visually-hidden text + `aria-hidden` on the visual price).
- **Test:** a11y assertion on the card's accessible name.

### C4 — Product card exposes three links to the same URL and a dead body
- **Location:** `client/components/catalog/ProductCard.tsx` (image link, title link, "View options" link)
- **Root cause:** each visual region got its own link.
- **Impact:** keyboard/SR users traverse the product three times; tapping the card padding does nothing.
- **Fix:** one stretched overlay link named by the product title; keep the icon decorative.
- **Test:** card exposes exactly one link in the a11y tree.

### C5 — Fixed dialog ids and duplicate accessible names
- **Location:** `client/components/catalog/SizeGuideDialog.tsx` (`id="size-guide-title"`), `client/components/catalog/ImageZoomDialog.tsx` (`id="image-zoom-title"`; two buttons both labelled `Zoom image: …`)
- **Root cause:** static ids/labels in reusable components.
- **Impact:** duplicate ids when two instances mount; two different controls with identical names.
- **Fix:** `useId()`; label the floating magnifier "Open larger image".
- **Test:** render two galleries → unique ids, distinct names.

### C6 — Global error page is off-brand
- **Location:** `client/app/global-error.tsx` (hard-coded `#14625c`, `#faf9f7`, `#1c1917`)
- **Root cause:** written before the design tokens existed.
- **Impact:** the last-resort screen looks like a different product.
- **Fix:** inline values matching `globals.css` tokens (this file cannot use the stylesheet).
- **Test:** unit assertion that the palette constants match the token file.

### C7 — No `prefers-reduced-motion` support
- **Location:** `client/app/globals.css`; smooth scrolling in `client/components/checkout/CheckoutClient.tsx` (`scrollIntoView({behavior:'smooth'})`); transitions across components
- **Root cause:** never added.
- **Impact:** WCAG 2.3.3 — motion-sensitive users cannot opt out.
- **Fix:** global `@media (prefers-reduced-motion: reduce)` disabling smooth scroll/transitions; guard the `scrollIntoView` behaviour.
- **Test:** media-query emulation test.

### C8 — Filter money math bypasses the money helpers
- **Location:** `client/components/catalog/ProductFilters.tsx` (`poisha / 100`, `Math.round(value * 100)`)
- **Root cause:** convenience helpers written inline.
- **Impact:** float arithmetic on money and a second, divergent implementation of taka↔poisha (the canonical one is exact decimal-string based).
- **Fix:** use `parseTakaToPoisha`/`poishaToTakaInput` from `lib/utils/money`.
- **Test:** unit tests for edge values (`89.99`, `0.01`, `1000`).

### C9 — Network failures are reported as wrong credentials
- **Location:** `client/components/auth/LoginForm.tsx` (any non-429 error → "Invalid email or password.")
- **Root cause:** deliberately generic copy applied too broadly.
- **Impact:** an API outage or offline phone tells the user their password is wrong → unnecessary password resets and support contacts.
- **Fix:** map 401 to the credential message; show "Could not reach the server, try again" for network/5xx.
- **Test:** mocked 500 → retry copy; mocked 401 → credential copy.

### C10 — Uploads are buffered in memory (10 × 5 MB per request)
- **Location:** `server/src/middleware/upload.ts` (multer memory storage)
- **Root cause:** content verification before storage requires a buffer; total size was never capped.
- **Impact:** a compromised or careless admin session can allocate 50 MB per request; parallel requests can OOM a small Render instance.
- **Fix:** add a total-bytes guard (per request and per user per minute) or stream to temp files and verify incrementally.
- **Test:** request exceeding the total cap → 400/413 without memory growth.

### C11 — Private pages have no `robots: noindex`
- **Location:** `client/app/account|orders|cart|checkout/page.tsx` (the admin layout has it)
- **Root cause:** reliance on `robots.txt` only.
- **Impact:** crawlers that ignore `robots.txt` can index private/transactional pages.
- **Fix:** add `robots: { index: false, follow: false }` to those pages/layouts.
- **Test:** metadata assertion in a unit test.

### C12 — Admin dashboard fan-out
- **Location:** `client/components/admin/AdminDashboard.tsx` calls `adminListOrders` 7× (5 counts with `limit: 1` + recent) plus low-stock
- **Root cause:** counts derived by listing.
- **Impact:** 7 round-trips and 5 collection counts per dashboard visit.
- **Fix:** one `GET /api/admin/stats` with a single `$facet`/`$group` aggregation.
- **Test:** dashboard renders from one request; aggregation numbers equal the current implementation.

### C13 — Sitemap correctness depends on the API at build time
- **Location:** `client/lib/api/server.ts` → `fetchProductsForSitemap` (falls back to `[]`), consumed by `client/app/sitemap.ts`
- **Root cause:** fail-open fallback with no signal.
- **Impact:** a Render cold start during a Vercel build silently ships a sitemap without product URLs, cached for an hour.
- **Fix:** log/mark the degraded build, or revalidate the sitemap on a schedule independent of deploys.
- **Test:** build with the API unreachable → warning emitted; page still builds.

### C14 — Checkout draft stores PII in `sessionStorage`
- **Location:** `client/lib/checkout/draft.ts` (name/phone/address), cleared by `client/components/checkout/CheckoutDraftGuard.tsx`
- **Root cause:** convenience feature; PII storage accepted implicitly.
- **Impact:** any script on the origin can read the draft; it survives reloads within the tab. Mitigated by session scope, same-origin scripts, and clearing on logout/user change.
- **Fix:** keep, but document the decision in PROJECT_CONTEXT §8; optionally clear on `pagehide` (never store more than the three fields — already true).
- **Test:** logout/user-switch clears the draft (regression).

---

## 5. Findings — D. Low

| ID | Finding | Location |
|---|---|---|
| D1 | PROJECT_CONTEXT is stale in four places: "no transactions", "helmet not approved" (installed and required by `env.ts`), "cancel pending/processing", variant images absent from the decisions table | `PROJECT_CONTEXT.md` §3/§6/§7/§9 |
| D2 | `OrderDto.status` / `paymentMethod` typed as `string` at the API boundary, losing the unions used elsewhere | `server/src/services/order.service.ts` (`OrderDto`) |
| D3 | No automated tests and no CI workflow anywhere in the repo | repo-wide |
| D4 | Broken indentation inside the `if (!adminOnly)` block | `server/src/scripts/seed.ts` |
| D5 | Trailing blank lines | `server/src/routes/index.ts` |
| D6 | Decorative thumbnails repeat the product name as `alt` (double announcement in cart/admin) | `client/components/catalog/ProductImage.tsx` + call sites |
| D7 | First paint shows no active nav item (state set in an effect) | `client/components/layout/Header.tsx` |
| D8 | Duplicate taka↔poisha conversions (see C8) | `client/components/catalog/ProductFilters.tsx` |
| D9 | Min/max price filters are not validated against each other before navigating | `client/components/catalog/ProductFilters.tsx` |
| D10 | Client caps `page` at 1000; the API enforces no upper bound | `client/lib/catalog/query.ts` vs `server/src/schemas/product.schema.ts` |
| D11 | Health router mounted twice (`/api/health` and `/health`) — intentional but undocumented | `server/src/app.ts`, `server/src/routes/index.ts` |
| D12 | Auth cookie has no `__Host-` prefix (cheap hardening; `secure` + `path=/` + no domain already hold in production) | `server/src/controllers/auth.controller.ts` |
| D13 | `role="menuitem"` used without a `role="menu"` container (invalid ARIA) | `client/components/layout/Header.tsx` |
| D14 | Request logging is unconditional `console.log` (no levels, sampling or request id) | `server/src/middleware/request-logger.ts` |

---

## 6. Security deep-dive

### 6.1 Payment verification (COD)
- `paymentMethod` is Zod-restricted to `['cod']`; `paymentStatus` is server-controlled; `delivered` is the only transition that sets `paid`, and it happens inside the admin-only, transaction-guarded status update. **Client input can never set payment state.** No finding.
- The pluggable provider (`payment.service.ts`) has no gateway integration yet, so there is no webhook/signature surface to attack. When one is added, `onOrderPlaced` runs *after* commit — a gateway failure will not roll back the order (correct for COD; must be revisited for prepaid).

### 6.2 Duplicate transactions / idempotency
- `checkoutId` (client UUID) is unique-sparse indexed and replayed before any work; a retried submission returns the existing order. Verified by code; **not exercised against a live database**.
- The cart claim (60 s staleness, timestamp-matched release) prevents two concurrent checkouts — but not concurrent cart mutation (**B1**).
- `adminUpdateOrderStatus` uses a guarded `findOneAndUpdate` with a status filter inside a transaction, so double-clicking "Mark as shipped" cannot apply twice.

### 6.3 Authorization / IDOR
- Every customer order route filters by `user: user._id`; order detail returns 404 (not 403) for other users' orders. Admin routes sit behind `requireAuth` + `requireRole('admin')`, and the role is re-read from the database on every request — a demoted admin loses access immediately even with a valid JWT.
- Address endpoints operate only on the authenticated user's embedded array. No IDOR found.
- Admin endpoints exposing customer data (list/detail, order list) are admin-only. No finding.

### 6.4 Order integrity & stock
- Snapshots are written at purchase time and never recomputed.
- Stock decrement is a guarded atomic update inside the transaction; `stockRestored` prevents double restoration; cancellation is guarded by `status` + `stockRestored`.
- **Gaps:** variant deletion vs. orders (**A5**), cart mutation during checkout (**B1**). Admin stock edits racing order decrements are already covered by the `expectedStock` compare-and-set added earlier (verified present).

### 6.5 Authentication & session
- httpOnly, `sameSite=lax`, `secure` in production, 7-day JWT, bcrypt cost 12, constant-time login for unknown emails and password-less (Google) accounts, generic error copy, Google ID tokens verified server-side with audience + `email_verified` checks, dev test-seam hard-blocked in production by env validation.
- Known trade-offs, already documented: stateless JWT means no server-side revocation on password change (low), and rate limiting is per-process (**B6**).
- CSRF: `sameSite=lax` + JSON bodies for state changes. `POST /orders/:id/cancel` and `POST /auth/logout` send no body, so they carry no `Content-Type: application/json`; a cross-site *form* POST would not include the cookie under `lax`, so they remain safe — but the invariant is implicit. Consider an explicit `Sec-Fetch-Site`/origin check for bodyless mutations (**hardening, not a defect**).

### 6.6 Input validation
- Every body/query/param is Zod-validated (params validated in controllers for orders/cart/users/admin/site-images). No mass assignment: services copy whitelisted fields. Customer search escapes regex metacharacters. Product search uses a text index (no regex injection). `objectIdSchema` blocks operator injection through ids.
- **Gap:** none beyond D10 (unbounded `page`).

### 6.7 Uploads
- Magic-byte content verification (not MIME), 5 MB per file, 10 files per request, Cloudinary-only deletion restricted to the configured folder, generated public ids, HEIC/AVIF/BMP/TIFF converted to JPEG. **Gap:** total memory per request (**C10**).

### 6.8 PII & privacy
- Checkout draft in `sessionStorage` (**C14**); order snapshots store the delivery phone/address by design (needed for order history); user DTOs never include `passwordHash`/`googleId` (also enforced by a `toJSON` transform); admins see phone/address (required by the product spec).

### 6.9 Secrets
- No secrets in the repo; `.env*` ignored; `.env.example` documents every variable; env validation refuses to boot in production with a weak admin password, missing `TRUST_PROXY`, missing Cloudinary credentials, or the Google test seam.

---

## 7. Requirements conformance

| Requirement (REQUIREMENTS.md / PROJECT_CONTEXT.md) | Status |
|---|---|
| Product page: gallery (≤5 photos, zoom), swatches, size buttons, stock labels, tabs, related products | **Met** (gallery/zoom/tabs/swatches/sizes/stock/related present; variant images drive the gallery) |
| Add to cart with immediate feedback + real server prices | **Met** (server cart; guest cart resolves through the API) |
| Cart + one-page checkout fast and clear on a phone | **Mostly met** — B3 (stale lines), B4 (guest-cart N+1) |
| Admin sees name, phone (tap to call), address on every order | **Met** (`tel:` link + copy-address) — but hard to *find* an order (B8) |
| Prices, stock, totals always from the server | **Met** |
| Compare-at price + computed discount badge | **Met** |
| Sticky Add to Cart on mobile | **Met** |
| Account required, Google sign-in, no guest checkout | **Met** |
| Checkout collects only name/phone/address; BD mobile normalization | **Met** |
| Profile + saved addresses (must-have) | **Partially met** — read-only UI (A2) |
| Cancel order (pending/processing) | **Mismatch** (B7) |
| Stock decrement / restore exactly once | **Met** except variant deletion (A5) |
| Loading / error / empty states everywhere | **Met** |
| No invented ratings, counts, urgency | **Met** (A3 is placeholder content, not fabricated claims) |
| Order snapshots preserved | **Met** |

---

## 8. Verified clean (explicitly checked)

Money as integer poisha; server-computed totals; compare-at rules and discount guards; order snapshots; `checkoutId` idempotency; `stockRestored`; admin transition table; httpOnly cookie + DB-read roles; bcrypt 12 + timing equaliser; Google token verification; Zod on every input; regex escaping; no `any`; no `dangerouslySetInnerHTML` except escaped JSON-LD; upload content verification; open-redirect guard; 44 px touch targets (measured live: 17/17 footer links, cart steppers, header icons); tablist roving tabindex; native `<dialog>` focus traps; live sitemap with product URLs (13 entries); broken-image fallbacks.

---

## 9. Not verified in this audit (and why)

- **No writes to the production database.** Checkout, idempotent replay, stock restore and variant deletion were verified by reading code paths, not by executing them against Atlas. A staging replica-set database is required to prove A1/A5/B1/B2.
- **No load test / penetration test.** Rate-limit behaviour (B6), memory ceilings (C10) and N+1 latency (B4) are reasoned from code, not measured.
- **No cross-browser/device matrix** — verified at 375 px and 1440 px in headless Chromium only.
- **`next.config.ts` flags** `cacheComponents` and `partialPrefetching` build successfully; re-check their interaction at the next Next.js upgrade.

---

## 10. Recommended remediation plan

- **Phase 1 — integrity (A1, A5, B1, B2).** Smallest diffs, highest risk reduction; all four are server-side and independently testable.
- **Phase 2 — launch blockers (A2, A3, A4, A6).** One UI slice plus content/config guards.
- **Phase 3 — checkout quality (B3, B4, B8).** Shared blocker helper, batch variant lookup, admin order search (+ index).
- **Phase 4 — accessibility batch (C1–C5, C7, C11).** Mechanical, high visible value.
- **Phase 5 — performance/observability (B5, B6, C12, C13, D14).**
- **Phase 6 — documentation truth-up (D1, D3, D5, D11).**

**Explicitly not recommended** (would add complexity without value for this MVP): replacing the hand-rolled client validation mirrors (server is authoritative), adding a client state library, replacing the in-memory rate limiter before more than one instance exists, adding CSRF tokens (no cross-site flow exists), or moving cart state out of React context.

---

## 11. Test plan proposal

The repo has no test runner. The stack supports `node:test` + `tsx` on the server with **no new dependencies**; React Testing Library would be a new dev dependency (needs approval).

**Server (node:test + tsx, against a replica-set test database):**
1. `createOrder` — happy path, snapshot fields, stock deltas, cart cleared.
2. Idempotent replay — same `checkoutId` twice → one order, one stock decrement.
3. Concurrency — racing checkouts; cart mutation during checkout (B1).
4. Cancel — pending → cancelled restores exactly once; second cancel 409; variant referenced by an order cannot be deleted (A5).
5. Admin transitions — full matrix, including delivered → paid.
6. `deleteVariant` / `deleteProduct` guards; last-variant rule.
7. Variant normalisation + bulk creation rollback; `expectedStock` conflict.
8. Upload content verification + total-size guard (C10).
9. Admin order search by number/phone (B8) + `explain()` index usage.
10. Auth — generic errors, timing path, Google audience/`email_verified` rejection.

**Client (React Testing Library, if approved):**
11. Checkout blocks on flagged cart lines (B3); error summary focus.
12. Cart stepper caps, undo window, out-of-stock fix action.
13. Login error mapping (C9); open-redirect guard.
14. Header active state after query navigation (B5).
15. a11y — one link per card (C4), unique dialog ids/names (C1/C5), mobile menu Escape (C2).

**Regression gates per PR:** `server tsc + eslint`, `client tsc + eslint + next build`, plus the suite above; a deployed-environment smoke script (login → catalog → cart → checkout → cancel) against staging.

---

## Appendix A — Evidence used

- File inventory and line counts for `server/src/**` and `client/{app,components,lib,config}/**`.
- Pattern scans: `\bany\b`, `TODO|FIXME|HACK`, `dangerouslySetInnerHTML|innerHTML|eval(`, `console.log`, `target="_blank"|<img |autoFocus|aria-live`, `prefers-reduced-motion`, hard-coded `id="…"`, metadata/`noindex`, route guards.
- Dependency and env alignment: `client/package.json`, `server/package.json`, both `.env.example`, `server/src/config/env.ts`.
- Read-only production checks: `GET /api/products/sitemap`, `GET /sitemap.xml` (13 URLs incl. 4 product pages), deployed CSS markers, footer geometry at 375 px via CDP.
- Local gates at commit `f39ac2a`: `server tsc`, `server eslint`, `client tsc`, `client eslint`, `client next build` — all clean.








