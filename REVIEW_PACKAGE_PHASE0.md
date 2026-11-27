# Phase 0 - Review Package (read-only snapshot)

**2026-11-17 final correction:** the original snapshot below is historical. The
authoritative R1–R5 diff and new-file snapshot are appended under **Final
corrective snapshot**. Final verification: 73/73 server and 19/19 client tests;
see `REVIEW_REPORT_PHASE0.md` and `AUDIT_PHASE0_IMPLEMENTATION_REPORT.md`.

**Repository:** `C:/Project/Abstract Lifestyle`  
**Branch:** `fix/audit-p0-order-integrity`  
**HEAD:** `f39ac2a88cabc263245138f77f6a63860a0c4791` (baseline `f39ac2a`, no commit made)  
**Diffstat (tracked):**  27 files changed, 637 insertions(+), 153 deletions(-)

Contents: (1) the complete tracked working-tree diff, (2) every new untracked source/test file.

Excluded on purpose: `server/.env`, `client/.env.local` (git-ignored private files), `node_modules/`, `client/.next/`,
`server/dist/`, uploaded files and any database data. `AUDIT_REPORT.md`, `AUDIT_PHASE0_IMPLEMENTATION_REPORT.md` and
`AGENTS.md` are separate documents and are not reproduced here.

Note: no credentials, connection strings, API keys or personal data appear in this package. The only URLs are
public ones (`https://abstract-lifestyle.vercel.app`) and local placeholders (`127.0.0.1`).

---

## 1. Tracked-file diff (working tree vs. `f39ac2a`)

```diff
diff --git a/API_DOCUMENTATION.md b/API_DOCUMENTATION.md
index 0694832..5186886 100644
--- a/API_DOCUMENTATION.md
+++ b/API_DOCUMENTATION.md
@@ -35,7 +35,7 @@ Codes: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_F
 | GET /products/sitemap | — | 200 `{ items: [{ slug, updatedAt }] }` — active product slugs for the client sitemap (capped at 5000, no catalog payload) |
 | GET /products/:slug | — | 200 `{ product, variants: [Variant], sizeGuideKey: 'clothing' \| null }` |
 | GET /site-images | — | 200 `{ items: [{ key, image }] }` — storefront marketing slots (`hero`, `promo-1`, `promo-2`); `image` = `{ url, publicId }` or `null` when empty |
-| GET /health | — | 200 `{ ok: true }` |
+| GET /health | — | 200 `{ ok: true, transactions: true }` — `transactions` reflects the connected deployment's ability to run order transactions; the API refuses to start without it |
 
 ProductCard: `{ id, name, slug, category, image, priceFrom, priceTo, sizes[], colors[], inStock, compareAtPrice, discountPercent, createdAt }` (`compareAtPrice` = original price applying to `priceFrom`, `null` = no sale; `discountPercent` = server-computed floor %, always `0` unless the compare-at is strictly greater than the price; `createdAt` = ISO 8601 creation timestamp used for the "New" badge)
 Variant: `{ id, sku, size, color, price (effective), compareAtPrice, discountPercent, stock, inStock, lowStock, images[] }` (`lowStock` = stock ≤ lowStockThreshold and > 0). Compare-at rule: a variant **with its own price** uses only its own `compareAtPrice` (none = no sale); a variant **without its own price** uses the product `compareAtPrice`.
@@ -45,7 +45,7 @@ Product (detail): `{ id, name, slug, description, category, basePrice, compareAt
 | Endpoint | Request | Response |
 |---|---|---|
 | GET /cart | — | 200 `{ items: [{ variantId, product, name, sku, size, color, image, unitPrice, quantity, lineTotal, outOfStock, insufficientStock, unavailable }], subtotal, shippingFee, total }` |
-| POST /cart/items | `{ variantId, quantity (1–20) }` | 200 cart — existing line's quantity increases, capped at available stock |
+| POST /cart/items | `{ variantId, quantity (1–20) }` | 200 cart — existing line's quantity increases, capped at available stock; 409 `CHECKOUT_IN_PROGRESS` while another checkout holds the cart claim |
 | PATCH /cart/items/:variantId | `{ quantity (1–20) }` | 200 cart — capped at available stock |
 | DELETE /cart/items/:variantId | — | 200 cart (idempotent) |
 | DELETE /cart | — | 200 cart — removes all items |
@@ -56,7 +56,7 @@ Cart notes: prices/stock are always recomputed from the DB (`unitPrice = variant
 ## Orders (customer)
 | Endpoint | Request | Response |
 |---|---|---|
-| POST /orders | `{ checkoutId (UUID), shippingAddressId }` OR `{ checkoutId, shippingAddress: {...} }`, `paymentMethod: 'cod'` | 201 `{ order }`; 409 on insufficient stock / empty cart / in-progress checkout. Idempotent: replaying the same `checkoutId` returns the existing order |
+| POST /orders | `{ checkoutId (UUID), shippingAddressId }` OR `{ checkoutId, shippingAddress: {...} }`, `paymentMethod: 'cod'` | 201 `{ order }`; 409 `CART_NOT_ORDERABLE` (with per-line `details[]`) when any line is archived/unpublished/out of stock/priceless, 409 `CHECKOUT_IN_PROGRESS`, 409 `CHECKOUT_CONFLICT` when the cart changed mid-checkout. Idempotent: replaying the same `checkoutId` returns the existing order |
 | GET /orders | `?page&limit` | 200 list envelope (own orders, newest first) |
 | GET /orders/:id | — | 200 `{ order }` (own or admin) |
 | POST /orders/:id/cancel | — | 200 `{ order }` — customer cancel only from `pending`; restores stock exactly once (double-cancel safe); 409 otherwise |
@@ -79,7 +79,7 @@ Order JSON: `{ id, orderNumber, checkoutId, status, paymentMethod, paymentStatus
 | PATCH /admin/variants/:id | partial, plus optional `expectedStock` | 200 `{ variant }` — stock edits are compare-and-set on `expectedStock` (409 when an order changed the stock meanwhile) |
 
 Sale pricing (admin): `POST/PATCH /admin/products` accept `compareAtPrice` (integer poisha; `null` clears it) and `variants` endpoints accept `compareAtPrice` (only used when the variant has its own `price`). A variant WITH its own price uses only its own compare-at (none = no sale); a variant WITHOUT its own price uses the product compare-at. Setting a compare-at that is not greater than the price returns 400 - Compare-at price must be greater than the price. Raising a price to or above the stored compare-at returns 400 - Price must be lower than the compare-at price. Clear or raise the compare-at price first. Public DTOs always return `discountPercent: 0` when the compare-at is not strictly greater than the price, so stale values never render a discount.
-| DELETE /admin/variants/:id | — | 204 (409 if it is the product's last variant) |
+| DELETE /admin/variants/:id | — | 204 hard delete (409 if it is the product's last purchasable variant); **200 `{ archived: true, orders: N }` when N orders reference the variant** — the document and its stock are retained so cancellations can restore inventory |
 | GET /admin/variants | `?lowStock=true&page&limit` | 200 list envelope (variant + product ref + `inStock`/`lowStock` flags) |
 | POST /admin/uploads | multipart `images[]` (jpeg/png/webp/heic/avif/bmp/tiff by content, ≤ 5 MB each, max 10) | 201 `{ assets: [{ url, publicId }] }` — content-verified (magic bytes) then uploaded to Cloudinary (`abstract-lifestyle/products`, cloud-generated public_id); HEIC/AVIF/BMP/TIFF are converted to JPEG on upload; `url` is the secure https URL |
 | POST /admin/uploads/destroy | `{ publicIds: string[] }` (1–20, own folder only) | 204 — deletes assets that were uploaded but never attached to a saved product (best-effort) |
diff --git a/DEPLOYMENT.md b/DEPLOYMENT.md
index 9324c1a..eb34965 100644
--- a/DEPLOYMENT.md
+++ b/DEPLOYMENT.md
@@ -30,7 +30,7 @@ each section before exposing the store to real customers.
 | Variable | Production requirement |
 |---|---|
 | `API_URL` | Internal/public origin the Next.js server uses to reach the API (e.g. `http://127.0.0.1:4000` on one host) |
-| `NEXT_PUBLIC_SITE_URL` | Public storefront origin (used by metadata, `robots.txt`, `sitemap.xml`) |
+| `NEXT_PUBLIC_SITE_URL` | Public storefront origin, used by metadata, canonical/OpenGraph URLs, `robots.txt` and `sitemap.xml`. **Required for any production build** and must be an absolute `https` origin that is not a loopback host (e.g. `https://abstract-lifestyle.vercel.app`); the build fails with an explicit error otherwise. Set it in **Vercel → Production** env vars; preview deployments fall back to their own `VERCEL_URL` when it is unset. |
 | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Identity Services client id (public by design — it configures the hosted Google button) |
 
 ### Vercel (client)
@@ -55,6 +55,19 @@ The `--include=dev` flag is required: `NODE_ENV=production` (set as a service en
 
 Set the **server** env table above (Production) in the Render dashboard; `TRUST_PROXY=1` is mandatory (Render proxies all traffic) and `PORT` is injected by Render — do not set it. Allow Render's outbound IPs in MongoDB Atlas Network Access. After the first deploy, run the seed once (`npm run seed:prod -- --admin-only`, or locally against the prod `MONGODB_URI`) unless the database is already seeded. Finally set `API_URL` in Vercel to the Render service URL (`https://<name>.onrender.com`) and redeploy the Vercel project; set `CLIENT_ORIGIN` on Render to the Vercel origin.
 
+### Local database (replica set required)
+
+Order checkout, cancellation and admin variant/product deletion use multi-document transactions. The API **refuses to start** against a standalone `mongod` and prints the fix. Run a single-node replica set locally:
+
+```bash
+mongod --replSet rs0 --dbpath ./data --port 27017
+mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
+```
+
+Then use `MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0&directConnection=true` (see `server/.env.example`). Managed MongoDB (Atlas, Render, etc.) already runs a replica set. `GET /api/health` reports `{ ok, transactions }` so a wrong topology is visible.
+
+Integration tests need a **disposable** replica set; see `server/test/README.md`. Never point them at production.
+
 - [ ] Every variable above is set from the host's secret manager — never committed to the repo
 - [ ] `server/.env.example` and `client/.env.example` list every variable used in code
 - [ ] `git grep -I "mongodb+srv"`, `git grep "JWT_SECRET="` etc. show only placeholders
diff --git a/PROJECT_CONTEXT.md b/PROJECT_CONTEXT.md
index 2d60ead..fb0b37b 100644
--- a/PROJECT_CONTEXT.md
+++ b/PROJECT_CONTEXT.md
@@ -68,7 +68,7 @@ Business logic lives only in /server. Next.js never duplicates backend logic; it
 | Shipping cost | Flat fee from `SHIPPING_FEE` env (integer poisha, default 0); no carrier integration |
 | Size guide | Static clothing size-chart component (not DB-managed) |
 | Products without options | Every product has ≥ 1 variant; no-option lifestyle products get one "default" variant (size/color = null) |
-| Stock decrement | Guarded atomic `findOneAndUpdate` + compensating rollback; no transactions (works on standalone Mongo) |
+| Stock decrement | Guarded atomic `findOneAndUpdate` inside a MongoDB **transaction** (replica set required); the API refuses to start on a standalone deployment |
 | Order cancellation | Only from pending/processing; stock restored once (guarded by `stockRestored`) |
 | Auth transport | Browser talks to same-origin `/api/*` via Next.js rewrites → Express; `cors` kept locked to `CLIENT_ORIGIN` as a safety net for direct access |
 | Auth token storage | JWT in **httpOnly cookie** (`al_token`): `httpOnly: true`, `sameSite: 'lax'`, `secure: true` in production (off over local http), `maxAge` = JWT expiry (7d) |
@@ -99,7 +99,7 @@ Business logic lives only in /server. Next.js never duplicates backend logic; it
 - Rate limiting (`express-rate-limit`) on auth endpoints.
 
 ## 9. Risks
-- **Stock without transactions:** multi-item orders use compensating rollback on standalone Mongo (small race window). Upgrade path: replica set + transactions.
+- **Transactions require a replica set:** checkout, cancellation and variant/product deletion use multi-document transactions, so the deployment must be a replica set or sharded cluster (Atlas is). A standalone `mongod` is rejected at startup with a diagnostic. Order cancellation aborts if a referenced variant is missing instead of reporting a false success; variants referenced by orders are archived (kept for history) rather than deleted.
 - **Dependency policy:** approved list only (§7); anything else (e.g. helmet) asks first.
 - **Local disk uploads** don't scale to multi-instance deploys (swap to cloud storage later).
 - **Text search** won't match partial words (e.g. "t-shi" misses "T-shirt").
diff --git a/client/.env.example b/client/.env.example
index 8850f39..46abaed 100644
--- a/client/.env.example
+++ b/client/.env.example
@@ -9,8 +9,11 @@
 API_URL=http://localhost:4000
 
 # Public origin of the storefront — used for metadata (metadataBase, Open Graph),
-# robots.txt and sitemap.xml. Default when unset: http://localhost:3000
-NEXT_PUBLIC_SITE_URL=http://localhost:3000
+# robots.txt and sitemap.xml.
+# Production builds REQUIRE this value: an absolute https origin that is not a
+# loopback host, otherwise the build fails fast instead of shipping localhost
+# canonicals. In development the localhost default below is fine.
+NEXT_PUBLIC_SITE_URL=https://abstract-lifestyle.vercel.app
 
 # Cloudinary cloud name (PUBLIC — it appears in every image URL). Used only to
 # restrict next/image remotePatterns to your cloud. The API key/secret live in
diff --git a/client/components/admin/VariantManager.tsx b/client/components/admin/VariantManager.tsx
index 3ac167c..771191a 100644
--- a/client/components/admin/VariantManager.tsx
+++ b/client/components/admin/VariantManager.tsx
@@ -379,9 +379,17 @@ export function VariantManager({
     setNotice(null);
     void (async () => {
       try {
-        await adminApi.deleteVariant(deleteTarget.id);
+        const result = await adminApi.deleteVariant(deleteTarget.id);
         await reload();
-        setNotice({ tone: 'success', message: `Variant ${deleteTarget.sku} deleted.` });
+        if (result?.archived) {
+          const orders = result.orders ?? 0;
+          setNotice({
+            tone: 'info',
+            message: `Variant ${deleteTarget.sku} is used by ${orders} order${orders === 1 ? '' : 's'}, so it was archived instead of deleted. It keeps its stock for cancellations and no longer appears on the storefront.`,
+          });
+        } else {
+          setNotice({ tone: 'success', message: `Variant ${deleteTarget.sku} deleted.` });
+        }
       } catch (error) {
         setNotice({
           tone: 'error',
@@ -597,6 +605,14 @@ export function VariantManager({
                 <tr key={variant.id} className="border-b border-line/60 last:border-0">
                   <th scope="row" className="py-2 pr-3 font-medium text-ink">
                     {variant.sku}
+                    {variant.archivedAt ? (
+                      <span
+                        className="ml-2 rounded-full border border-line bg-tile px-2 py-0.5 text-[11px] font-medium text-muted"
+                        title={`Archived ${new Date(variant.archivedAt).toLocaleDateString('en-GB')} — kept for order history`}
+                      >
+                        Archived
+                      </span>
+                    ) : null}
                   </th>
                   <td className="py-2 pr-3 text-muted">
                     {[variant.size, variant.color].filter(Boolean).join(' / ') || '—'}
diff --git a/client/components/checkout/CheckoutClient.tsx b/client/components/checkout/CheckoutClient.tsx
index efcf562..138173e 100644
--- a/client/components/checkout/CheckoutClient.tsx
+++ b/client/components/checkout/CheckoutClient.tsx
@@ -70,6 +70,7 @@ export function CheckoutClient() {
   const [formError, setFormError] = useState<string | null>(null);
   const [errorList, setErrorList] = useState<Array<{ field: keyof AddressFormValues; message: string }>>([]);
   const [conflict, setConflict] = useState<string | null>(null);
+  const [conflictDetails, setConflictDetails] = useState<string[]>([]);
   const [retryNote, setRetryNote] = useState<string | null>(null);
   const [summaryOpen, setSummaryOpen] = useState(false);
   const [reloadKey, setReloadKey] = useState(0);
@@ -207,6 +208,7 @@ export function CheckoutClient() {
     setFormError(null);
     setErrorList([]);
     setConflict(null);
+    setConflictDetails([]);
     setRetryNote(null);
 
     if (!checkoutIdRef.current) {
@@ -254,17 +256,23 @@ export function CheckoutClient() {
       router.push(`/orders/${order.id}?placed=1`);
     } catch (error) {
       if (error instanceof ApiError && error.status === 409) {
-        if (
-          error.message.includes('Item no longer available') ||
-          error.message.includes('Insufficient stock')
-        ) {
+        if (error.code === 'CART_NOT_ORDERABLE') {
+          // The server re-validated every line; show exactly what must be fixed.
           setConflict(error.message);
-        } else if (error.message.includes('Checkout already in progress')) {
+          setConflictDetails(error.details.map((detail) => detail.message));
+        } else if (error.code === 'CHECKOUT_IN_PROGRESS' || error.code === 'CHECKOUT_CONFLICT') {
           setRetryNote(
-            'Checkout is already in progress. Please wait a moment and try again.',
+            error.code === 'CHECKOUT_CONFLICT'
+              ? 'Your cart changed while the order was placed. Review it and try again.'
+              : 'Checkout is already in progress. Please wait a moment and try again.',
           );
         } else if (error.message.includes('Cart is empty')) {
           setConflict('Your cart is empty.');
+        } else if (
+          error.message.includes('Item no longer available') ||
+          error.message.includes('Insufficient stock')
+        ) {
+          setConflict(error.message);
         } else {
           setFormError(error.message);
         }
@@ -393,6 +401,13 @@ export function CheckoutClient() {
           {conflict ? (
             <Notice tone="error">
               <p>{conflict}</p>
+              {conflictDetails.length > 0 ? (
+                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
+                  {conflictDetails.map((detail) => (
+                    <li key={detail}>{detail}</li>
+                  ))}
+                </ul>
+              ) : null}
               <Button
                 variant="secondary"
                 size="sm"
diff --git a/client/lib/api/admin.ts b/client/lib/api/admin.ts
index 2562c6a..5fcd258 100644
--- a/client/lib/api/admin.ts
+++ b/client/lib/api/admin.ts
@@ -85,7 +85,10 @@ export const adminApi = {
   updateVariant: (id: string, payload: Partial<VariantPayload>) =>
     apiFetch<{ variant: AdminVariant }>(`/admin/variants/${id}`, { method: 'PATCH', body: payload }),
   deleteVariant: (id: string) =>
-    apiFetch<void>(`/admin/variants/${id}`, { method: 'DELETE' }),
+    // 204 = hard delete; 200 = archived because orders reference it.
+    apiFetch<{ archived?: boolean; orders?: number } | undefined>(`/admin/variants/${id}`, {
+      method: 'DELETE',
+    }),
   listLowStockVariants: (limit = 10) =>
     apiFetch<ListEnvelope<AdminVariant>>(`/admin/variants?lowStock=true&page=1&limit=${limit}`),
 
diff --git a/client/lib/seo.ts b/client/lib/seo.ts
index 8f4a062..bef85ec 100644
--- a/client/lib/seo.ts
+++ b/client/lib/seo.ts
@@ -1,7 +1,19 @@
 import { site } from '@/config/site';
+import { resolveSiteUrl } from '@/lib/site-url';
 
-/** Single source of truth for the public site URL and shared SEO defaults. */
-export const SITE_URL = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');
+/**
+ * Single source of truth for the public site URL and shared SEO defaults.
+ *
+ * `resolveSiteUrl` refuses to fall back to localhost in a production build, so a
+ * missing/misconfigured NEXT_PUBLIC_SITE_URL fails the deploy instead of shipping
+ * localhost canonicals, OpenGraph URLs, robots.txt and sitemap entries.
+ */
+export const SITE_URL = resolveSiteUrl({
+  raw: process.env.NEXT_PUBLIC_SITE_URL,
+  nodeEnv: process.env.NODE_ENV,
+  vercelEnv: process.env.VERCEL_ENV,
+  vercelUrl: process.env.VERCEL_URL,
+});
 
 export const SITE_NAME = site.name;
 
diff --git a/client/lib/types/admin.ts b/client/lib/types/admin.ts
index bda6d79..68bc88c 100644
--- a/client/lib/types/admin.ts
+++ b/client/lib/types/admin.ts
@@ -53,6 +53,8 @@ export interface AdminVariant {
   stock: number;
   lowStockThreshold: number;
   images: string[];
+  /** Set when the variant is retired (kept for order history, never sold). */
+  archivedAt: string | null;
   inStock: boolean;
   lowStock: boolean;
 }
diff --git a/client/lib/types/api.ts b/client/lib/types/api.ts
index 7a5b28d..8d12cb8 100644
--- a/client/lib/types/api.ts
+++ b/client/lib/types/api.ts
@@ -6,7 +6,15 @@ export type ApiErrorCode =
   | 'NOT_FOUND'
   | 'CONFLICT'
   | 'RATE_LIMITED'
-  | 'SERVER_ERROR';
+  | 'SERVER_ERROR'
+  /** Checkout: one or more cart lines can no longer be ordered (details[]). */
+  | 'CART_NOT_ORDERABLE'
+  /** Checkout/cart: another checkout currently holds the cart claim. */
+  | 'CHECKOUT_IN_PROGRESS'
+  /** Checkout: the cart changed while the order was being placed. */
+  | 'CHECKOUT_CONFLICT'
+  /** Cancellation: the inventory could not be restored, so nothing changed. */
+  | 'STOCK_RESTORE_FAILED';
 
 export interface ApiErrorDetail {
   path: string;
diff --git a/client/package.json b/client/package.json
index 4b68a0c..c07e2a9 100644
--- a/client/package.json
+++ b/client/package.json
@@ -7,7 +7,8 @@
     "build": "next build",
     "start": "next start",
     "lint": "eslint",
-    "type-check": "next typegen && tsc --noEmit"
+    "type-check": "next typegen && tsc --noEmit",
+    "test": "node --test lib/__tests__/site-url.test.ts"
   },
   "dependencies": {
     "next": "16.4.5",
diff --git a/client/tsconfig.json b/client/tsconfig.json
index 3a13f90..470837e 100644
--- a/client/tsconfig.json
+++ b/client/tsconfig.json
@@ -9,6 +9,7 @@
     "esModuleInterop": true,
     "module": "esnext",
     "moduleResolution": "bundler",
+    "allowImportingTsExtensions": true,
     "resolveJsonModule": true,
     "isolatedModules": true,
     "jsx": "react-jsx",
diff --git a/server/.env.example b/server/.env.example
index 0cae8e0..f007e7e 100644
--- a/server/.env.example
+++ b/server/.env.example
@@ -9,8 +9,15 @@ NODE_ENV=development
 # Port the Express API listens on
 PORT=4000
 
-# MongoDB connection string (used from Task 2 onward)
-MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle
+# MongoDB connection string. Checkout, cancellation and variant/product deletion
+# use multi-document transactions, so the API requires a replica set or sharded
+# cluster (MongoDB Atlas is a replica set). A standalone mongod is rejected at
+# startup with a diagnostic.
+#
+# Local single-node replica set:
+#   mongod --replSet rs0 --dbpath ./data --port 27017
+#   mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
+MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0&directConnection=true
 
 # Secret used to sign JWTs (minimum 32 characters).
 # Generate one with:
diff --git a/server/package.json b/server/package.json
index 526a417..296e383 100644
--- a/server/package.json
+++ b/server/package.json
@@ -15,7 +15,11 @@
     "normalize-variants": "tsx src/scripts/normalize-variants.ts",
     "normalize-variants:prod": "node dist/scripts/normalize-variants.js",
     "type-check": "tsc --noEmit",
-    "lint": "eslint ."
+    "type-check:test": "tsc --noEmit -p tsconfig.test.json",
+    "lint": "eslint .",
+    "test": "node --import tsx --test test/mongo-capabilities.test.ts test/checkout-version-filter.test.ts test/topology-guard.test.ts test/order-integrity.test.ts",
+    "test:unit": "node --import tsx --test test/mongo-capabilities.test.ts test/checkout-version-filter.test.ts",
+    "test:db": "node --import tsx --test test/topology-guard.test.ts test/order-integrity.test.ts"
   },
   "dependencies": {
     "bcryptjs": "^3.0.3",
diff --git a/server/src/config/db.ts b/server/src/config/db.ts
index a508d69..4ea7f50 100644
--- a/server/src/config/db.ts
+++ b/server/src/config/db.ts
@@ -1,12 +1,54 @@
 import mongoose from 'mongoose';
 import { env } from './env.js';
+import {
+  readDeploymentCapabilities,
+  transactionRequirementMessage,
+  type DeploymentCapabilities,
+} from './mongo-capabilities.js';
 
-export const connectDB = async (): Promise<void> => {
-  await mongoose.connect(env.MONGODB_URI);
+/** Capabilities of the current connection (null before connect / after disconnect). */
+let capabilities: DeploymentCapabilities | null = null;
+
+export interface ConnectOptions {
+  /**
+   * Fail the connection when the deployment cannot run multi-document
+   * transactions. The API requires them (checkout, cancellation); one-off
+   * maintenance scripts that only touch single documents may opt out.
+   */
+  requireTransactions?: boolean;
+  /** Override the configured URI (tests exercise specific topologies). */
+  uri?: string;
+}
+
+export const connectDB = async ({
+  requireTransactions = true,
+  uri = env.MONGODB_URI,
+}: ConnectOptions = {}): Promise<void> => {
+  await mongoose.connect(uri);
+
+  const db = mongoose.connection.db;
+  if (!db) {
+    await mongoose.disconnect();
+    throw new Error('MongoDB connected but no database handle is available.');
+  }
+
+  const deployment = await readDeploymentCapabilities(db);
+  if (requireTransactions && !deployment.transactions) {
+    // Never run the API in a mode where every checkout would fail at runtime.
+    await mongoose.disconnect();
+    capabilities = null;
+    throw new Error(transactionRequirementMessage(deployment));
+  }
+
+  capabilities = deployment;
   const { name } = mongoose.connection;
-  console.log(`MongoDB connected${name ? ` (db: ${name})` : ''}`);
+  console.log(`MongoDB connected${name ? ` (db: ${name})` : ''} — ${deployment.detail}`);
 };
 
+/** Topology facts of the active connection (used by the readiness endpoint). */
+export const getDeploymentCapabilities = (): DeploymentCapabilities | null => capabilities;
+
 export const disconnectDB = async (): Promise<void> => {
   await mongoose.disconnect();
+  capabilities = null;
 };
diff --git a/server/src/controllers/admin.controller.ts b/server/src/controllers/admin.controller.ts
index 9156d78..4b0d9ab 100644
--- a/server/src/controllers/admin.controller.ts
+++ b/server/src/controllers/admin.controller.ts
@@ -87,7 +87,12 @@ export const updateVariantHandler: RequestHandler = async (req, res) => {
 
 export const deleteVariantHandler: RequestHandler = async (req, res) => {
   const { id } = adminIdParamsSchema.parse(req.params);
-  await deleteVariant(id);
+  const result = await deleteVariant(id);
+  if (result.archived) {
+    // Kept for order history: the stock target must survive cancellations.
+    res.status(200).json({ archived: true, orders: result.orderCount });
+    return;
+  }
   res.status(204).end();
 };
 
diff --git a/server/src/controllers/health.controller.ts b/server/src/controllers/health.controller.ts
index fe17885..a928666 100644
--- a/server/src/controllers/health.controller.ts
+++ b/server/src/controllers/health.controller.ts
@@ -1,5 +1,6 @@
 import mongoose from 'mongoose';
 import type { RequestHandler } from 'express';
+import { getDeploymentCapabilities } from '../config/db.js';
 
 /** True only when the default connection is open AND MongoDB answers a ping. */
 const isDatabaseReady = async (): Promise<boolean> => {
@@ -16,6 +17,9 @@ const isDatabaseReady = async (): Promise<boolean> => {
 
 export const getHealth: RequestHandler = async (_req, res) => {
   const ok = await isDatabaseReady();
-  // Status only — never expose error details.
-  res.status(ok ? 200 : 503).json({ ok });
+  // Readiness includes the transaction capability: checkout/cancel cannot work
+  // without it, and the API refuses to start when it is missing.
+  const transactions = getDeploymentCapabilities()?.transactions ?? false;
+  // Status only — never expose error details or connection information.
+  res.status(ok ? 200 : 503).json({ ok, transactions });
 };
diff --git a/server/src/models/cart.model.ts b/server/src/models/cart.model.ts
index e56dd79..1d056a4 100644
--- a/server/src/models/cart.model.ts
+++ b/server/src/models/cart.model.ts
@@ -10,6 +10,11 @@ export interface Cart {
   items: CartItem[];
   /** Timestamp of an active checkout claim; claims older than 60s are stale. */
   checkoutInProgress: Date | null;
+  /**
+   * Optimistic concurrency counter. Every cart mutation and the checkout clear
+   * compare-and-swap on it, so a write can never overwrite a newer state.
+   */
+  version: number;
   createdAt: Date;
   updatedAt: Date;
 }
@@ -31,6 +36,8 @@ const cartSchema = new Schema<Cart>(
     // Guards against concurrent checkout (double submit) for the same cart.
     // A claim older than CHECKOUT_CLAIM_STALE_MS is treated as crashed/stale.
     checkoutInProgress: { type: Date, default: null },
+    // Bumped on every cart write; the checkout clear CASes on it.
+    version: { type: Number, default: 0, min: 0 },
   },
   { timestamps: true },
 );
diff --git a/server/src/models/variant.model.ts b/server/src/models/variant.model.ts
index 4ff3d7e..30f17e7 100644
--- a/server/src/models/variant.model.ts
+++ b/server/src/models/variant.model.ts
@@ -15,6 +15,12 @@ export interface Variant {
   stock: number;
   lowStockThreshold: number;
   images: string[];
+  /**
+   * Set when the variant is retired because orders reference it: the document
+   * (and its stock) is kept so cancellations can restore inventory and order
+   * snapshots keep a valid target. Archived variants are never sold.
+   */
+  archivedAt?: Date | null;
   createdAt: Date;
   updatedAt: Date;
 }
@@ -30,6 +36,7 @@ const variantSchema = new Schema<Variant>(
     stock: { type: Number, required: true, min: 0, default: 0 },
     lowStockThreshold: { type: Number, default: LOW_STOCK_THRESHOLD_DEFAULT, min: 0 },
     images: { type: [String], default: [] },
+    archivedAt: { type: Date, default: null },
   },
   { timestamps: true },
 );
@@ -38,4 +45,5 @@ variantSchema.index({ product: 1 });
 variantSchema.index({ sku: 1 }, { unique: true });
 variantSchema.index({ product: 1, size: 1, color: 1 }, { unique: true });
 
+
 export const VariantModel = model<Variant>('Variant', variantSchema);
diff --git a/server/src/scripts/normalize-variants.ts b/server/src/scripts/normalize-variants.ts
index 9fbee4a..47bcf9f 100644
--- a/server/src/scripts/normalize-variants.ts
+++ b/server/src/scripts/normalize-variants.ts
@@ -38,7 +38,7 @@ const main = async (): Promise<void> => {
   console.log(`Target: ${target}`);
   console.log(apply ? 'Mode: APPLY (writes changes)' : 'Mode: dry-run (pass --apply to write)');
 
-  await connectDB();
+  await connectDB({ requireTransactions: false });
 
   const variants = await VariantModel.find().select('product sku size color').exec();
   type VariantDoc = (typeof variants)[number];
diff --git a/server/src/scripts/seed.ts b/server/src/scripts/seed.ts
index d654469..f148dd8 100644
--- a/server/src/scripts/seed.ts
+++ b/server/src/scripts/seed.ts
@@ -89,7 +89,7 @@ const seed = async (): Promise<void> => {
   // `--admin-only` seeds the admin user + category trees and skips the demo
   // products/variants (use this for production databases).
   const adminOnly = process.argv.includes('--admin-only');
-  await connectDB();
+  await connectDB({ requireTransactions: false });
 
   // 1. Admin user (credentials from env — see .env.example)
   const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
diff --git a/server/src/scripts/set-role.ts b/server/src/scripts/set-role.ts
index fb48bbf..1d97d1b 100644
--- a/server/src/scripts/set-role.ts
+++ b/server/src/scripts/set-role.ts
@@ -64,7 +64,7 @@ const main = async (): Promise<void> => {
 
   const { email, role } = args;
 
-  await connectDB();
+  await connectDB({ requireTransactions: false });
   try {
     const user = await UserModel.findOne({ email }).select('email role').exec();
     if (!user) {
diff --git a/server/src/services/admin-catalog.service.ts b/server/src/services/admin-catalog.service.ts
index 3f3c8d8..f99f403 100644
--- a/server/src/services/admin-catalog.service.ts
+++ b/server/src/services/admin-catalog.service.ts
@@ -1,4 +1,4 @@
-import { Types } from 'mongoose';
+import mongoose, { Types } from 'mongoose';
 import { AppError } from '../middleware/error-handler.js';
 import { COMPARE_AT_RULE_MESSAGE, PRICE_RULE_MESSAGE } from '../utils/pricing.js';
 import { CategoryModel } from '../models/category.model.js';
@@ -61,6 +61,8 @@ export interface VariantAdminDto {
   stock: number;
   lowStockThreshold: number;
   images: string[];
+  /** ISO timestamp when the variant was retired (kept for order history). */
+  archivedAt: string | null;
   inStock: boolean;
   lowStock: boolean;
 }
@@ -110,7 +112,7 @@ const variantStats = async (productIds: Types.ObjectId[]): Promise<Map<string, V
     count: number;
     totalStock: number;
   }>([
-    { $match: { product: { $in: productIds } } },
+    { $match: { product: { $in: productIds }, archivedAt: null } },
     { $group: { _id: '$product', count: { $sum: 1 }, totalStock: { $sum: '$stock' } } },
   ]).exec();
 
@@ -397,7 +399,10 @@ export const updateProduct = async (
 
   // Publishing requires a purchasable product: one variant and one image.
   if (input.status === 'active') {
-    const variantCount = await VariantModel.countDocuments({ product: product._id }).exec();
+    const variantCount = await VariantModel.countDocuments({
+      product: product._id,
+      archivedAt: null,
+    }).exec();
     if (variantCount === 0) {
       throw new AppError(
         400,
@@ -442,29 +447,75 @@ export const updateProduct = async (
 export const deleteProduct = async (
   productId: string,
 ): Promise<{ deleted: boolean; product?: ProductAdminDto; orderCount?: number }> => {
-  const product = await ProductModel.findById(productId).exec();
-  if (!product) {
-    throw new AppError(404, 'NOT_FOUND', 'Product not found');
+  const session = await mongoose.startSession();
+  const result: {
+    deleted?: boolean;
+    orderCount?: number;
+    imagePublicIds?: Array<string | null>;
+  } = {};
+
+  try {
+    await session.withTransaction(async () => {
+      const product = await ProductModel.findById(productId).session(session).exec();
+      if (!product) {
+        throw new AppError(404, 'NOT_FOUND', 'Product not found');
+      }
+
+      // Products referenced by orders are archived: order snapshots keep a valid
+      // product document and its variants (stock targets) stay intact.
+      const orderCount = await OrderModel.countDocuments({ 'items.product': product._id })
+        .session(session)
+        .exec();
+      if (orderCount > 0) {
+        product.status = 'archived';
+        await product.save({ session });
+        result.deleted = false;
+        result.orderCount = orderCount;
+        return;
+      }
+
+      // Remember the assets before the document is gone (Cloudinary cleanup runs
+      // after the commit, best-effort).
+      result.imagePublicIds = normalizeImages(product.images).map((asset) => asset.publicId);
+
+      // Cascade delete inside the same transaction: the variant writes conflict
+      // with a concurrent checkout, so a product that is being bought can never
+      // be deleted underneath it (the retry sees the order and archives instead).
+      await VariantModel.deleteMany({ product: product._id }, { session }).exec();
+      const removed = await ProductModel.deleteOne({ _id: product._id }, { session }).exec();
+      if (removed.deletedCount !== 1) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'Product changed while it was being deleted. Please try again.',
+        );
+      }
+      result.deleted = true;
+      result.orderCount = 0;
+    });
+  } finally {
+    await session.endSession();
   }
 
-  // Prefer archiving over hard delete for products referenced by orders: the
-  // snapshot rows must keep pointing at a product document.
-  const orderCount = await OrderModel.countDocuments({ 'items.product': product._id }).exec();
-  if (orderCount > 0) {
-    product.status = 'archived';
-    await product.save();
+  if (result.deleted === undefined) {
+    throw new AppError(
+      409,
+      'CONFLICT',
+      'Product changed while it was being deleted. Please try again.',
+    );
+  }
+
+  if (!result.deleted) {
+    const archived = await ProductModel.findById(productId).exec();
     return {
       deleted: false,
-      product: toProductDto(product, await statsForProduct(product._id)),
-      orderCount,
+      product: archived ? toProductDto(archived, await statsForProduct(archived._id)) : undefined,
+      orderCount: result.orderCount ?? 0,
     };
   }
 
-  await VariantModel.deleteMany({ product: product._id }).exec();
-  await ProductModel.deleteOne({ _id: product._id }).exec();
-
-  // Hard delete succeeded → best-effort cleanup of the Cloudinary assets.
-  await destroyImageAssets(normalizeImages(product.images).map((asset) => asset.publicId));
+  // Hard delete committed → best-effort cleanup of the Cloudinary assets.
+  await destroyImageAssets(result.imagePublicIds ?? []);
 
   return { deleted: true };
 };
@@ -481,6 +532,7 @@ const toVariantDto = (
     stock: number;
     lowStockThreshold: number;
     images: string[];
+    archivedAt?: Date | null;
   },
   product: { _id: Types.ObjectId; name: string; slug: string },
 ): VariantAdminDto => ({
@@ -494,6 +546,7 @@ const toVariantDto = (
   stock: variant.stock,
   lowStockThreshold: variant.lowStockThreshold,
   images: variant.images,
+  archivedAt: variant.archivedAt ? variant.archivedAt.toISOString() : null,
   inStock: isInStock(variant.stock),
   lowStock: isLowStock(variant.stock, variant.lowStockThreshold),
 });
@@ -750,28 +803,101 @@ export const updateVariant = async (
   return toVariantDto(updated, product);
 };
 
-export const deleteVariant = async (variantId: string): Promise<void> => {
-  const variant = await VariantModel.findById(variantId).exec();
-  if (!variant) {
-    throw new AppError(404, 'NOT_FOUND', 'Variant not found');
+export interface VariantDeleteResult {
+  deleted: boolean;
+  archived: boolean;
+  orderCount: number;
+}
+
+/**
+ * Deletes a variant — or archives it when orders reference it.
+ *
+ * The decision happens inside a transaction that writes to the variant document
+ * first. A checkout decrementing the same variant therefore conflicts with this
+ * transaction, serialising the two: either the checkout commits first (the order
+ * is visible on retry and the variant is archived, keeping its id and stock for
+ * cancellations), or the deletion commits first and the checkout fails its
+ * guarded decrement. Stock can never be restored into a missing document.
+ */
+export const deleteVariant = async (variantId: string): Promise<VariantDeleteResult> => {
+  const session = await mongoose.startSession();
+  const result: { outcome: VariantDeleteResult | null } = { outcome: null };
+
+  try {
+    await session.withTransaction(async () => {
+      const variant = await VariantModel.findById(variantId).session(session).exec();
+      if (!variant) {
+        throw new AppError(404, 'NOT_FOUND', 'Variant not found');
+      }
+
+      // Write first: this is what makes a concurrent checkout conflict with us.
+      const marked = await VariantModel.updateOne(
+        { _id: variant._id },
+        { $set: { archivedAt: variant.archivedAt ?? new Date() } },
+        { session },
+      ).exec();
+      if (marked.matchedCount !== 1) {
+        throw new AppError(404, 'NOT_FOUND', 'Variant not found');
+      }
+
+      const orderCount = await OrderModel.countDocuments({ 'items.variant': variant._id })
+        .session(session)
+        .exec();
+
+      if (orderCount > 0) {
+        // Referenced by history: keep the document (and its stock) even when it is
+        // the product's last variant — the admin's intent is to stop selling it.
+        result.outcome = { deleted: false, archived: true, orderCount };
+        return;
+      }
+
+      // A hard delete must leave at least one purchasable variant behind.
+      const activeSiblings = await VariantModel.countDocuments({
+        product: variant.product,
+        _id: { $ne: variant._id },
+        archivedAt: null,
+      })
+        .session(session)
+        .exec();
+      if (activeSiblings === 0) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'This is the product’s only purchasable variant — add another variant first (a product needs at least one).',
+        );
+      }
+
+      const removed = await VariantModel.deleteOne({ _id: variant._id }, { session }).exec();
+      if (removed.deletedCount !== 1) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'Variant changed while it was being deleted. Please try again.',
+        );
+      }
+
+      result.outcome = { deleted: true, archived: false, orderCount: 0 };
+    });
+  } finally {
+    await session.endSession();
   }
 
-  const siblingCount = await VariantModel.countDocuments({ product: variant.product }).exec();
-  if (siblingCount <= 1) {
+  const outcome = result.outcome;
+  if (!outcome) {
     throw new AppError(
       409,
       'CONFLICT',
-      'This is the product’s only variant — add another variant first (a product needs at least one).',
+      'Variant changed while it was being deleted. Please try again.',
     );
   }
-
-  await VariantModel.deleteOne({ _id: variant._id }).exec();
+  return outcome;
 };
 
 export const listVariants = async (
   query: AdminVariantQuery,
 ): Promise<AdminListResult<VariantAdminDto>> => {
-  const filter: Record<string, unknown> = {};
+  // Low-stock monitoring only looks at variants that can still be sold.
+  const filter: Record<string, unknown> = { archivedAt: null };
   if (query.lowStock === 'true') {
     filter.$expr = {
       $and: [{ $lte: ['$stock', '$lowStockThreshold'] }, { $gt: ['$stock', 0] }],
diff --git a/server/src/services/admin-order.service.ts b/server/src/services/admin-order.service.ts
index f329f12..bac9d2c 100644
--- a/server/src/services/admin-order.service.ts
+++ b/server/src/services/admin-order.service.ts
@@ -112,11 +112,20 @@ export const adminUpdateOrderStatus = async (
       // Status change + stock restore + flag commit together or not at all.
       if (target === 'cancelled') {
         for (const item of updated.items) {
-          await VariantModel.updateOne(
+          const restored = await VariantModel.updateOne(
             { _id: item.variant },
             { $inc: { stock: item.quantity } },
             { session },
           ).exec();
+          // A missing variant cannot be restocked: abort the transaction rather
+          // than leaving a cancelled order with unrestored inventory.
+          if (restored.modifiedCount !== 1) {
+            throw new AppError(
+              409,
+              'STOCK_RESTORE_FAILED',
+              `Cannot restore stock for ${item.sku}: the variant no longer exists. The order was not cancelled.`,
+            );
+          }
         }
       }
 
diff --git a/server/src/services/cart.service.ts b/server/src/services/cart.service.ts
index ba89000..b70ae36 100644
--- a/server/src/services/cart.service.ts
+++ b/server/src/services/cart.service.ts
@@ -1,7 +1,13 @@
 import type { HydratedDocument, Types } from 'mongoose';
+import {
+  CART_MUTATION_ATTEMPTS,
+  CHECKOUT_CLAIM_STALE_MS,
+  CHECKOUT_IN_PROGRESS_MESSAGE,
+  cartVersionFilter,
+} from '../config/checkout.js';
 import { env } from '../config/env.js';
 import { AppError } from '../middleware/error-handler.js';
-import { CartModel, type CartDocument } from '../models/cart.model.js';
+import { CartModel, type CartDocument, type CartItem } from '../models/cart.model.js';
 import { ProductModel, type Product } from '../models/product.model.js';
 import { VariantModel, type Variant } from '../models/variant.model.js';
 import { mergeCartItemSchema, type MergeCartItemInput } from '../schemas/cart.schema.js';
@@ -35,25 +41,105 @@ export interface CartView {
 type VariantDoc = HydratedDocument<Variant>;
 type ProductDoc = HydratedDocument<Product>;
 
+const isDuplicateKeyError = (error: unknown): boolean =>
+  typeof error === 'object' &&
+  error !== null &&
+  'code' in error &&
+  (error as { code?: unknown }).code === 11000;
+
+/** True while another request holds a non-stale checkout claim on the cart. */
+const hasActiveCheckout = (cart: { checkoutInProgress: Date | null }, now: number): boolean =>
+  cart.checkoutInProgress !== null &&
+  now - cart.checkoutInProgress.getTime() < CHECKOUT_CLAIM_STALE_MS;
+
 const getOrCreateCart = async (userId: Types.ObjectId): Promise<CartDocument> => {
-  const cart = await CartModel.findOneAndUpdate(
-    { user: userId },
-    { $setOnInsert: { user: userId, items: [] } },
-    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
-  ).exec();
-
-  if (!cart) {
-    throw new AppError(500, 'SERVER_ERROR', 'Failed to load cart');
+  const existing = await CartModel.findOne({ user: userId }).exec();
+  if (existing) {
+    return existing;
+  }
+
+  try {
+    const created = await CartModel.findOneAndUpdate(
+      { user: userId },
+      { $setOnInsert: { user: userId, items: [], version: 0 } },
+      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
+    ).exec();
+
+    if (!created) {
+      throw new AppError(500, 'SERVER_ERROR', 'Failed to load cart');
+    }
+    return created;
+  } catch (error) {
+    // Two first-time requests can race the unique user index. The loser simply
+    // re-reads the winner's cart — never a 500, never a second cart.
+    if (isDuplicateKeyError(error)) {
+      const raced = await CartModel.findOne({ user: userId }).exec();
+      if (raced) {
+        return raced;
+      }
+    }
+    throw error;
+  }
+};
+
+/**
+ * Applies a cart mutation through a compare-and-swap on `version`, and only
+ * while no checkout claim is active. This is what stops a cart write from being
+ * silently erased by checkout's final clear (or vice versa):
+ *
+ * - mutations are rejected with 409 while checkout holds a non-stale claim;
+ * - a concurrent mutation makes the CAS fail and the operation retries on the
+ *   freshly loaded cart instead of overwriting it;
+ * - checkout itself clears with the same CAS (see order.service).
+ */
+const mutateCart = async (
+  userId: Types.ObjectId,
+  mutate: (items: CartItem[]) => CartItem[],
+): Promise<CartDocument> => {
+  for (let attempt = 1; attempt <= CART_MUTATION_ATTEMPTS; attempt += 1) {
+    const cart = await getOrCreateCart(userId);
+    const now = Date.now();
+
+    if (hasActiveCheckout(cart, now)) {
+      throw new AppError(409, 'CHECKOUT_IN_PROGRESS', CHECKOUT_IN_PROGRESS_MESSAGE);
+    }
+
+    const nextItems = mutate(
+      cart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
+    );
+    const staleCutoff = new Date(now - CHECKOUT_CLAIM_STALE_MS);
+
+    const updated = await CartModel.findOneAndUpdate(
+      {
+        _id: cart._id,
+        $and: [
+          cartVersionFilter(cart.version),
+          { $or: [{ checkoutInProgress: null }, { checkoutInProgress: { $lt: staleCutoff } }] },
+        ],
+      },
+      { $set: { items: nextItems }, $inc: { version: 1 } },
+      { returnDocument: 'after' },
+    ).exec();
+
+    if (updated) {
+      return updated;
+    }
+    // Lost the race (concurrent mutation or a claim appeared) → retry.
   }
-  return cart;
+
+  throw new AppError(
+    409,
+    'CONFLICT',
+    'Your cart changed in another request. Please try again.',
+  );
 };
 
-/** Loads a variant + product, or null when unknown/inactive. */
+/** Loads a variant + product, or null when unknown/inactive/archived. */
 const findAvailableVariant = async (
   variantId: string,
 ): Promise<{ variant: NonNullable<VariantDoc>; product: NonNullable<ProductDoc> } | null> => {
   const variant = await VariantModel.findById(variantId).exec();
-  if (!variant) {
+  if (!variant || variant.archivedAt) {
     return null;
   }
   const product = await ProductModel.findById(variant.product).exec();
@@ -92,7 +178,7 @@ const buildCartView = async (cart: CartDocument): Promise<CartView> => {
     const color = variant?.color ?? null;
     const image = variant?.images[0] ?? firstImageUrl(product?.images) ?? null;
 
-    if (!variant || !product || product.status !== 'active') {
+    if (!variant || !product || product.status !== 'active' || variant.archivedAt) {
       return {
         variantId,
         product: variant ? variant.product.toString() : null,
@@ -154,19 +240,20 @@ export const addItem = async (
     throw new AppError(409, 'CONFLICT', 'Insufficient stock');
   }
 
-  const cart = await getOrCreateCart(userId);
-  const existing = cart.items.find((item) => item.variant.toString() === variantId);
-  const currentQuantity = existing ? existing.quantity : 0;
-  const targetQuantity = Math.min(currentQuantity + quantity, variant.stock);
+  const updated = await mutateCart(userId, (items) => {
+    const existing = items.find((item) => item.variant.toString() === variantId);
+    const currentQuantity = existing ? existing.quantity : 0;
+    // Stock is re-read above; the cap is enforced server-side, never the client.
+    const targetQuantity = Math.min(currentQuantity + quantity, variant.stock);
 
-  if (existing) {
-    existing.quantity = targetQuantity;
-  } else {
-    cart.items.push({ variant: variant._id, quantity: targetQuantity });
-  }
+    if (existing) {
+      existing.quantity = targetQuantity;
+      return items;
+    }
+    return [...items, { variant: variant._id, quantity: targetQuantity }];
+  });
 
-  await cart.save();
-  return buildCartView(cart);
+  return buildCartView(updated);
 };
 
 export const updateItem = async (
@@ -174,12 +261,6 @@ export const updateItem = async (
   variantId: string,
   quantity: number,
 ): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
-  const existing = cart.items.find((item) => item.variant.toString() === variantId);
-  if (!existing) {
-    throw new AppError(404, 'NOT_FOUND', 'Item not in cart');
-  }
-
   const available = await findAvailableVariant(variantId);
   if (!available) {
     throw new AppError(409, 'CONFLICT', 'Item is no longer available');
@@ -189,23 +270,28 @@ export const updateItem = async (
     throw new AppError(409, 'CONFLICT', 'Insufficient stock');
   }
 
-  existing.quantity = Math.min(quantity, variant.stock);
-  await cart.save();
-  return buildCartView(cart);
+  const updated = await mutateCart(userId, (items) => {
+    const existing = items.find((item) => item.variant.toString() === variantId);
+    if (!existing) {
+      throw new AppError(404, 'NOT_FOUND', 'Item not in cart');
+    }
+    existing.quantity = Math.min(quantity, variant.stock);
+    return items;
+  });
+
+  return buildCartView(updated);
 };
 
 export const removeItem = async (userId: Types.ObjectId, variantId: string): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
-  cart.items = cart.items.filter((item) => item.variant.toString() !== variantId);
-  await cart.save();
-  return buildCartView(cart);
+  const updated = await mutateCart(userId, (items) =>
+    items.filter((item) => item.variant.toString() !== variantId),
+  );
+  return buildCartView(updated);
 };
 
 export const clearCart = async (userId: Types.ObjectId): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
-  cart.items = [];
-  await cart.save();
-  return buildCartView(cart);
+  const updated = await mutateCart(userId, () => []);
+  return buildCartView(updated);
 };
 
 /** Merges a guest (localStorage) cart. Invalid entries are skipped, valid ones are capped at stock. */
@@ -213,7 +299,7 @@ export const mergeGuestItems = async (
   userId: Types.ObjectId,
   rawItems: unknown[],
 ): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
+  const additions: Array<{ variant: NonNullable<VariantDoc>; quantity: number }> = [];
 
   for (const raw of rawItems) {
     const parsed = mergeCartItemSchema.safeParse(raw);
@@ -226,20 +312,29 @@ export const mergeGuestItems = async (
     if (!available || available.variant.stock === 0) {
       continue;
     }
-    const { variant } = available;
+    additions.push({ variant: available.variant, quantity: entry.quantity });
+  }
 
-    const existing = cart.items.find((item) => item.variant.toString() === entry.variantId);
-    const currentQuantity = existing ? existing.quantity : 0;
-    const targetQuantity = Math.min(currentQuantity + entry.quantity, variant.stock);
+  const updated = await mutateCart(userId, (items) => {
+    for (const addition of additions) {
+      const existing = items.find(
+        (item) => item.variant.toString() === addition.variant._id.toString(),
+      );
+      const currentQuantity = existing ? existing.quantity : 0;
+      const targetQuantity = Math.min(
+        currentQuantity + addition.quantity,
+        addition.variant.stock,
+      );
 
-    if (existing) {
-      existing.quantity = targetQuantity;
-    } else {
-      cart.items.push({ variant: variant._id, quantity: targetQuantity });
+      if (existing) {
+        existing.quantity = targetQuantity;
+      } else {
+        items.push({ variant: addition.variant._id, quantity: targetQuantity });
+      }
     }
-  }
+    return items;
+  });
 
-  await cart.save();
-  return buildCartView(cart);
+  return buildCartView(updated);
 };
 
diff --git a/server/src/services/order.service.ts b/server/src/services/order.service.ts
index 7ca6a95..7bed007 100644
--- a/server/src/services/order.service.ts
+++ b/server/src/services/order.service.ts
@@ -1,4 +1,5 @@
 import mongoose, { type ClientSession, type Types } from 'mongoose';
+import { CHECKOUT_CLAIM_STALE_MS, cartVersionFilter } from '../config/checkout.js';
 import { env } from '../config/env.js';
 import { AppError } from '../middleware/error-handler.js';
 import { CartModel } from '../models/cart.model.js';
@@ -52,9 +53,6 @@ export interface OrderListResult {
 
 const ORDER_NUMBER_ATTEMPTS = 3;
 
-/** A checkout claim older than this is considered stale (crashed request) and can be re-claimed. */
-const CHECKOUT_CLAIM_STALE_MS = 60_000;
-
 const isDuplicateKeyError = (error: unknown): boolean =>
   typeof error === 'object' &&
   error !== null &&
@@ -110,20 +108,34 @@ const resolveShippingAddress = (
   return { fullName, phone, line1, line2, city, state, postalCode, country };
 };
 
+interface CartLineIssue {
+  path: string;
+  message: string;
+}
+
+/**
+ * Rebuilds order lines from the database and rejects anything that is not
+ * genuinely orderable. Runs once before the checkout claim (fast, actionable
+ * feedback) and again inside the transaction (authoritative).
+ *
+ * Checks per line: positive quantity, variant exists and is not archived,
+ * product exists and is active, price is a positive integer in poisha, and the
+ * requested quantity is within stock. All issues are returned together so the
+ * shopper can fix the cart in one pass.
+ */
 const buildOrderItems = async (
   cartItems: Array<{ variant: Types.ObjectId; quantity: number }>,
-  session: ClientSession,
+  session?: ClientSession,
 ): Promise<OrderItem[]> => {
-  const variants = await VariantModel.find({
+  const variantQuery = VariantModel.find({
     _id: { $in: cartItems.map((item) => item.variant) },
-  })
-    .session(session)
-    .exec();
-  const products = await ProductModel.find({
+  });
+  const variants = await (session ? variantQuery.session(session) : variantQuery).exec();
+
+  const productQuery = ProductModel.find({
     _id: { $in: variants.map((variant) => variant.product) },
-  })
-    .session(session)
-    .exec();
+  });
+  const products = await (session ? productQuery.session(session) : productQuery).exec();
 
   const variantById = new Map<string, (typeof variants)[number]>();
   for (const variant of variants) {
@@ -134,20 +146,52 @@ const buildOrderItems = async (
     productById.set(product._id.toString(), product);
   }
 
-  return cartItems.map((cartItem) => {
+  const issues: CartLineIssue[] = [];
+  const items: OrderItem[] = [];
+
+  for (const cartItem of cartItems) {
     const variant = variantById.get(cartItem.variant.toString());
-    const product = variant ? productById.get(variant.product.toString()) : undefined;
-
-    if (!variant || !product || product.status !== 'active') {
-      throw new AppError(
-        409,
-        'CONFLICT',
-        `Item no longer available: ${variant?.sku ?? 'unknown'}`,
-      );
+    const label = variant?.sku ?? 'Unknown item';
+
+    if (!Number.isInteger(cartItem.quantity) || cartItem.quantity < 1) {
+      issues.push({ path: 'items', message: `${label}: quantity is not valid` });
+      continue;
+    }
+    if (!variant) {
+      issues.push({ path: 'items', message: `${label}: this item is no longer available` });
+      continue;
+    }
+    if (variant.archivedAt) {
+      issues.push({ path: 'items', message: `${variant.sku}: this item is no longer sold` });
+      continue;
+    }
+
+    const product = productById.get(variant.product.toString());
+    if (!product || product.status !== 'active') {
+      issues.push({
+        path: 'items',
+        message: `${variant.sku}: this product is not available right now`,
+      });
+      continue;
     }
 
     const unitPrice = variant.price ?? product.basePrice;
-    return {
+    if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
+      issues.push({
+        path: 'items',
+        message: `${variant.sku}: the price is unavailable, so it cannot be ordered`,
+      });
+      continue;
+    }
+    if (variant.stock < cartItem.quantity) {
+      issues.push({
+        path: 'items',
+        message: `${variant.sku}: only ${variant.stock} left in stock`,
+      });
+      continue;
+    }
+
+    items.push({
       product: product._id,
       variant: variant._id,
       name: product.name,
@@ -158,8 +202,19 @@ const buildOrderItems = async (
       unitPrice,
       quantity: cartItem.quantity,
       lineTotal: unitPrice * cartItem.quantity,
-    };
-  });
+    });
+  }
+
+  if (issues.length > 0) {
+    throw new AppError(
+      409,
+      'CART_NOT_ORDERABLE',
+      'Some items in your cart can no longer be ordered. Review the cart and try again.',
+      issues,
+    );
+  }
+
+  return items;
 };
 
 export const createOrder = async (
@@ -185,6 +240,12 @@ export const createOrder = async (
     throw new AppError(409, 'CONFLICT', 'Cart is empty');
   }
 
+  // Fail fast with per-line reasons before claiming the cart; the same checks
+  // run again inside the transaction, where they are authoritative.
+  await buildOrderItems(
+    cart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
+  );
+
   // Double-submit guard: atomically claim checkout for this cart. A claim that
   // is older than CHECKOUT_CLAIM_STALE_MS counts as stale (crashed request).
   const claimTime = new Date();
@@ -198,8 +259,10 @@ export const createOrder = async (
     { returnDocument: 'after' },
   ).exec();
   if (!claimed) {
-    throw new AppError(409, 'CONFLICT', 'Checkout already in progress');
+    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'Checkout already in progress');
   }
+  // Version the claim was taken on — the final clear compare-and-swaps on it.
+  const claimedVersion = claimed.version;
 
   // Stock decrements, order creation and cart clearing happen in ONE
   // transaction: any failure aborts everything automatically, so no manual
@@ -211,8 +274,17 @@ export const createOrder = async (
     for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt += 1) {
       try {
         await session.withTransaction(async () => {
-          // Re-validate and re-price everything from the database (inside the session).
-          const items = await buildOrderItems([...cart.items], session);
+          // Re-read the cart inside the transaction. The checkout claim blocks
+          // cart writes, and this read is the snapshot the order is built from —
+          // never the copy loaded before the claim.
+          const freshCart = await CartModel.findOne({ _id: cart._id }).session(session).exec();
+          if (!freshCart || freshCart.items.length === 0) {
+            throw new AppError(409, 'CONFLICT', 'Cart is empty');
+          }
+          const items = await buildOrderItems(
+            freshCart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
+            session,
+          );
           const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
           const shippingFee = env.SHIPPING_FEE;
           const total = subtotal + shippingFee;
@@ -254,15 +326,24 @@ export const createOrder = async (
             throw new AppError(500, 'SERVER_ERROR', 'Failed to create order');
           }
 
-          // Clear the cart only if we still hold our claim (stale takeovers
-          // must not wipe a cart that already belongs to a newer checkout).
+          // Compare-and-swap the clear: the claim timestamp AND the cart version
+          // captured at claim time must still match, so a cart that changed
+          // underneath this checkout can never be erased by it.
           const cleared = await CartModel.updateOne(
-            { _id: cart._id, checkoutInProgress: claimTime },
-            { $set: { items: [] } },
+            {
+              _id: cart._id,
+              checkoutInProgress: claimTime,
+              ...cartVersionFilter(claimedVersion),
+            },
+            { $set: { items: [], checkoutInProgress: null }, $inc: { version: 1 } },
             { session },
           ).exec();
-          if (cleared.modifiedCount !== 1) {
-            throw new AppError(409, 'CONFLICT', 'Checkout already in progress');
+          if (cleared.matchedCount !== 1) {
+            throw new AppError(
+              409,
+              'CHECKOUT_CONFLICT',
+              'Your cart changed during checkout. Please review it and try again.',
+            );
           }
 
           result.created = order;
@@ -370,13 +451,22 @@ export const cancelOrder = async (user: UserDocument, orderId: string): Promise<
         throw new AppError(409, 'CONFLICT', 'Order cannot be cancelled');
       }
 
-      // Only the winner of the guarded transition above restores stock.
+      // Only the winner of the guarded transition above restores stock. A
+      // missing variant means inventory cannot be made whole, so the whole
+      // cancellation is aborted instead of reporting a false success.
       for (const item of updated.items) {
-        await VariantModel.updateOne(
+        const restored = await VariantModel.updateOne(
           { _id: item.variant },
           { $inc: { stock: item.quantity } },
           { session },
         ).exec();
+        if (restored.modifiedCount !== 1) {
+          throw new AppError(
+            409,
+            'STOCK_RESTORE_FAILED',
+            `Cannot restore stock for ${item.sku}: the variant no longer exists. The order was not cancelled.`,
+          );
+        }
       }
 
       result.cancelled = toOrderDto(updated);
diff --git a/server/src/services/product.service.ts b/server/src/services/product.service.ts
index a3a6347..9a25cf2 100644
--- a/server/src/services/product.service.ts
+++ b/server/src/services/product.service.ts
@@ -181,6 +181,19 @@ export const listProducts = async (query: ProductListQuery): Promise<ProductList
         as: 'variantDocs',
       },
     },
+    {
+      // Archived variants are kept for order history only — never priced,
+      // counted or shown on the storefront.
+      $addFields: {
+        variantDocs: {
+          $filter: {
+            input: '$variantDocs',
+            as: 'variant',
+            cond: { $eq: [{ $ifNull: ['$$variant.archivedAt', null] }, null] },
+          },
+        },
+      },
+    },
     {
       $addFields: {
         effectivePrices: {
@@ -369,7 +382,7 @@ export const getProductBySlug = async (slug: string): Promise<ProductDetail> =>
   }
 
   const [variants, category, sizeGuideKey] = await Promise.all([
-    VariantModel.find({ product: product._id }).sort({ size: 1, color: 1 }).exec(),
+    VariantModel.find({ product: product._id, archivedAt: null }).sort({ size: 1, color: 1 }).exec(),
     CategoryModel.findById(product.category).exec(),
     resolveSizeGuideKey(product.category),
   ]);

```

---

## 2. New file: `server/src/config/checkout.ts` (25 lines)

```ts
/**
 * Checkout claim lease. A cart marked `checkoutInProgress` older than this is
 * treated as a crashed checkout and may be re-claimed / mutated again.
 *
 * Shared by the cart service (rejects mutations during an active checkout) and
 * the order service (claims / releases the cart) so both sides always agree.
 */
export const CHECKOUT_CLAIM_STALE_MS = 60_000;

/** Maximum attempts for an optimistic cart mutation before giving up. */
export const CART_MUTATION_ATTEMPTS = 3;

export const CHECKOUT_IN_PROGRESS_MESSAGE =
  'Checkout is in progress for this cart. Finish or cancel it, then try again.';

/**
 * Compare-and-swap filter for the cart `version`.
 *
 * Carts created before the version field existed have no stored value; Mongoose
 * hydrates the default `0`, but the document itself has no such field until its
 * first write. Treating "missing" as version 0 keeps those carts mutable
 * instead of failing every compare-and-swap.
 */
export const cartVersionFilter = (version: number): Record<string, unknown> =>
  version === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version };
```

---

## 2. New file: `server/src/config/mongo-capabilities.ts` (81 lines)

```ts
import type { Db } from 'mongodb';

/**
 * What the connected MongoDB deployment can actually do.
 *
 * Order creation and cancellation rely on multi-document transactions, which
 * require a replica set or a sharded cluster — a standalone `mongod` silently
 * accepts the connection but fails every transaction at runtime. The API
 * refuses to start in that case instead of returning 500s to shoppers.
 */
export interface DeploymentCapabilities {
  /** True only when multi-document transactions are supported. */
  transactions: boolean;
  kind: 'replica-set' | 'sharded' | 'standalone' | 'unknown';
  /** Human-readable detail for diagnostics (never contains credentials). */
  detail: string;
}

/** Minimal shape of the `hello` command response we rely on. */
export interface HelloResult {
  setName?: unknown;
  msg?: unknown;
  logicalSessionTimeoutMinutes?: unknown;
  isWritablePrimary?: unknown;
}

/**
 * Pure classification of a `hello` payload. Kept separate from the driver call
 * so it can be unit-tested without a database.
 */
export const classifyDeployment = (hello: HelloResult): DeploymentCapabilities => {
  const isSharded = hello.msg === 'isdbgrid';
  const isReplicaSet = typeof hello.setName === 'string' && hello.setName.length > 0;
  const supportsSessions = typeof hello.logicalSessionTimeoutMinutes === 'number';

  if (isSharded) {
    return {
      transactions: true,
      kind: 'sharded',
      detail: 'sharded cluster (mongos) supports multi-document transactions',
    };
  }

  if (isReplicaSet) {
    return {
      transactions: supportsSessions,
      kind: 'replica-set',
      detail: supportsSessions
        ? `replica set "${hello.setName}" with session support`
        : `replica set "${hello.setName}" without logical session support (transactions unavailable)`,
    };
  }

  return {
    transactions: false,
    kind: supportsSessions ? 'unknown' : 'standalone',
    detail:
      'standalone/unknown deployment without a replica set — multi-document transactions are not supported',
  };
};

/** Read-only topology inspection (`hello`). Never writes and never logs the URI. */
export const readDeploymentCapabilities = async (db: Db): Promise<DeploymentCapabilities> => {
  const hello = (await db.admin().command({ hello: 1 })) as HelloResult;
  return classifyDeployment(hello);
};

/**
 * Diagnostic shown when the deployment cannot support order transactions.
 * Includes the executable local fix so the failure is self-service.
 */
export const transactionRequirementMessage = (capabilities: DeploymentCapabilities): string =>
  [
    'This MongoDB deployment cannot run order transactions, which checkout and cancellation require.',
    `Detected: ${capabilities.detail}.`,
    'Run a replica set instead of a standalone mongod. Local single-node example:',
    '  mongod --replSet rs0 --dbpath /path/to/data --port 27017',
    '  mongosh --eval "rs.initiate({_id: \\"rs0\\", members: [{_id: 0, host: \\"127.0.0.1:27017\\"}]})"',
    'Then set MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0 and restart.',
    'Managed MongoDB (Atlas) already runs a replica set — check Network Access/credentials if this appears there.',
  ].join('\n');
```

---

## 2. New file: `server/tsconfig.test.json` (8 lines)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

---

## 2. New file: `server/test/setup-env.ts` (19 lines)

```ts
/**
 * Test environment bootstrap. MUST be the first import in every server test file:
 * `src/config/env.ts` validates `process.env` at import time.
 *
 * Integration tests are skipped unless `MONGODB_TEST_URI` points at a disposable
 * *replica set* (transactions are required). See `server/test/README.md`.
 */
const testUri = (process.env.MONGODB_TEST_URI ?? '').trim();

process.env.NODE_ENV = 'test';
// env.ts requires a URI/JWT/admin credentials even for tests; the placeholder is
// only used when the real test database is absent (tests are skipped then).
process.env.MONGODB_URI =
  testUri.length > 0 ? testUri : 'mongodb://127.0.0.1:27017/abstract_lifestyle_p0_unavailable';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-p0-'.padEnd(48, 'x');
process.env.CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:3000';
process.env.SHIPPING_FEE = process.env.SHIPPING_FEE ?? '0';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'p0-admin@example.com';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'p0-test-admin-password';
```

---

## 2. New file: `server/test/mongo-capabilities.test.ts` (48 lines)

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDeployment,
  transactionRequirementMessage,
  type HelloResult,
} from '../src/config/mongo-capabilities.js';

describe('A1 — deployment capability classification', () => {
  it('accepts a replica set with logical sessions', () => {
    const hello: HelloResult = { setName: 'atlas-abc', logicalSessionTimeoutMinutes: 30 };
    const caps = classifyDeployment(hello);
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'replica-set');
    assert.match(caps.detail, /replica set "atlas-abc"/);
  });

  it('rejects a replica set without logical sessions', () => {
    const caps = classifyDeployment({ setName: 'rs0' });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'replica-set');
  });

  it('accepts a sharded cluster (mongos)', () => {
    const caps = classifyDeployment({ msg: 'isdbgrid', logicalSessionTimeoutMinutes: 30 });
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'sharded');
  });

  it('rejects a standalone server', () => {
    const caps = classifyDeployment({ isWritablePrimary: true });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'standalone');
  });

  it('treats a session-capable but unnamed topology as unknown, not transactional', () => {
    const caps = classifyDeployment({ logicalSessionTimeoutMinutes: 30 });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'unknown');
  });

  it('explains how to run a local replica set', () => {
    const message = transactionRequirementMessage(classifyDeployment({}));
    assert.match(message, /--replSet rs0/);
    assert.match(message, /rs\.initiate/);
    assert.match(message, /MONGODB_URI/);
  });
});
```

---

## 2. New file: `server/test/checkout-version-filter.test.ts` (15 lines)

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cartVersionFilter } from '../src/config/checkout.js';

describe('B1 — cart version compare-and-swap filter', () => {
  it('accepts legacy carts that have no stored version when expecting 0', () => {
    assert.deepEqual(cartVersionFilter(0), {
      $or: [{ version: 0 }, { version: { $exists: false } }],
    });
  });

  it('matches the exact version for a cart that already has one', () => {
    assert.deepEqual(cartVersionFilter(3), { version: 3 });
  });
});
```

---

## 2. New file: `server/test/topology-guard.test.ts` (59 lines)

```ts
import './setup-env.js';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDB, disconnectDB, getDeploymentCapabilities } from '../src/config/db.js';
import { OrderModel } from '../src/models/order.model.js';

const replicaSetUri = (process.env.MONGODB_TEST_URI ?? '').trim();
const standaloneUri = (process.env.MONGODB_STANDALONE_URI ?? '').trim();

const skipStandalone: string | false =
  standaloneUri.length > 0
    ? false
    : 'MONGODB_STANDALONE_URI is not set — start a plain mongod (no --replSet) to exercise the guard';
const skipReplica: string | false =
  replicaSetUri.length > 0 ? false : 'MONGODB_TEST_URI is not set';

describe('A1 — startup refuses a deployment without transactions', { skip: skipStandalone }, () => {
  after(async () => {
    await disconnectDB().catch(() => undefined);
  });

  it('fails with an actionable diagnostic and leaves no usable connection', async () => {
    await assert.rejects(connectDB({ uri: standaloneUri }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /cannot run order transactions/);
      assert.match(error.message, /--replSet rs0/);
      assert.match(error.message, /rs\.initiate/);
      return true;
    });

    assert.equal(mongoose.connection.readyState, 0, 'connection is closed after the refusal');
    assert.equal(getDeploymentCapabilities(), null, 'no capability is published');

    // No order writes are possible: the driver cannot reach a database.
    await assert.rejects(OrderModel.countDocuments().exec());
  });
});

describe('A1 — startup accepts a replica set', { skip: skipReplica }, () => {
  after(async () => {
    await disconnectDB().catch(() => undefined);
  });

  it('connects, reports transaction support and answers a ping', async () => {
    await connectDB({ uri: replicaSetUri });

    const capabilities = getDeploymentCapabilities();
    assert.ok(capabilities);
    assert.equal(capabilities.transactions, true);
    assert.ok(
      capabilities.kind === 'replica-set' || capabilities.kind === 'sharded',
      `unexpected topology: ${capabilities.detail}`,
    );

    const ping = await mongoose.connection.db?.admin().command({ ping: 1 });
    assert.equal(ping?.ok, 1);
  });
});
```

---

## 2. New file: `server/test/order-integrity.test.ts` (638 lines)

```ts
import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { readDeploymentCapabilities } from '../src/config/mongo-capabilities.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { deleteVariant } from '../src/services/admin-catalog.service.js';
import { addItem, clearCart, getCart, mergeGuestItems, removeItem, updateItem } from '../src/services/cart.service.js';
import { cancelOrder, createOrder } from '../src/services/order.service.js';
import { AppError } from '../src/middleware/error-handler.js';
import { CHECKOUT_CLAIM_STALE_MS } from '../src/config/checkout.js';

const testUri = (process.env.MONGODB_TEST_URI ?? '').trim();
const skipDb: string | false =
  testUri.length > 0
    ? false
    : 'MONGODB_TEST_URI is not set — run against a disposable replica set (see server/test/README.md)';

let sequence = 0;
const unique = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

interface Fixture {
  user: UserDocument;
  product: Types.ObjectId;
  variant: Types.ObjectId;
  sku: string;
}

const makeFixture = async (
  options: { stock?: number; price?: number | null; basePrice?: number } = {},
): Promise<Fixture> => {
  const tag = unique('p0');
  const user = await UserModel.create({
    email: `${tag}@example.com`,
    name: 'P0 Test User',
    role: 'customer',
  });
  const category = await CategoryModel.create({ name: `Cat ${tag}`, slug: `cat-${tag}` });
  const product = await ProductModel.create({
    name: `Product ${tag}`,
    slug: `product-${tag}`,
    description: 'Fixture product for Phase 0 regression tests.',
    category: category._id,
    basePrice: options.basePrice ?? 10000,
    images: [],
    status: 'active',
  });
  const sku = `SKU-${tag}`;
  const variant = await VariantModel.create({
    product: product._id,
    sku,
    size: 'M',
    color: null,
    price: options.price === undefined ? null : options.price,
    stock: options.stock ?? 10,
    lowStockThreshold: 5,
    images: [],
  });

  return { user, product: product._id, variant: variant._id, sku: variant.sku };
};

const addSecondVariant = async (fixture: Fixture, stock = 5): Promise<Types.ObjectId> => {
  const variant = await VariantModel.create({
    product: fixture.product,
    sku: `SKU2-${unique('v')}`,
    size: 'L',
    color: null,
    price: null,
    stock,
    lowStockThreshold: 5,
    images: [],
  });
  return variant._id;
};

const placeOrder = async (user: UserDocument, checkoutId = randomUUID()) =>
  createOrder(user, {
    checkoutId,
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'P0 Test User',
      phone: '01700000000',
      line1: 'House 1, Road 1',
      isDefault: true,
    },
  });

const stockOf = async (variantId: Types.ObjectId): Promise<number | null> => {
  const variant = await VariantModel.findById(variantId).select('stock').lean().exec();
  return variant ? variant.stock : null;
};

const resetDatabase = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) {
    return;
  }
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
};

describe('Phase 0 — order integrity (A5, B1, B2, B3)', { skip: skipDb }, () => {
  before(async () => {
    await mongoose.connect(testUri);

    // A1: the suite refuses to run on a deployment without transactions.
    const db = mongoose.connection.db;
    assert.ok(db, 'connected database handle is available');
    const capabilities = await readDeploymentCapabilities(db);
    assert.equal(
      capabilities.transactions,
      true,
      `test database must be a replica set (${capabilities.detail})`,
    );

    await Promise.all([
      UserModel.syncIndexes(),
      CategoryModel.syncIndexes(),
      ProductModel.syncIndexes(),
      VariantModel.syncIndexes(),
      CartModel.syncIndexes(),
      OrderModel.syncIndexes(),
    ]);
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  after(async () => {
    await mongoose.disconnect();
  });

  // ---- A5 -----------------------------------------------------------------
  describe('A5 — variant deletion vs. order history', () => {
    it('archives a variant referenced by an order and restores its stock on cancel', async () => {
      const fixture = await makeFixture({ stock: 10 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      assert.equal(await stockOf(fixture.variant), 8);

      const result = await deleteVariant(fixture.variant.toString());
      assert.deepEqual(result, { deleted: false, archived: true, orderCount: 1 });

      const archived = await VariantModel.findById(fixture.variant).lean().exec();
      assert.ok(archived, 'variant document is retained');
      assert.ok(archived.archivedAt instanceof Date);
      assert.equal(archived.stock, 8);

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 10, 'stock restored into the archived variant');
    });

    it('hard-deletes a variant that no order references', async () => {
      const fixture = await makeFixture({ stock: 4 });
      const second = await addSecondVariant(fixture, 3);

      const result = await deleteVariant(second.toString());
      assert.deepEqual(result, { deleted: true, archived: false, orderCount: 0 });
      assert.equal(await VariantModel.findById(second).lean().exec(), null);
    });

    it('refuses to retire the last purchasable variant', async () => {
      const fixture = await makeFixture({ stock: 4 });
      await assert.rejects(deleteVariant(fixture.variant.toString()), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /only purchasable variant/);
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 4);
    });

    it('aborts the cancellation when the variant no longer exists (no false success)', async () => {
      const fixture = await makeFixture({ stock: 6 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      // Simulate legacy data: the variant document is gone while the order lives.
      await VariantModel.deleteOne({ _id: fixture.variant }).exec();

      await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'STOCK_RESTORE_FAILED');
        return true;
      });

      const reloaded = await OrderModel.findById(order.id).lean().exec();
      assert.ok(reloaded);
      assert.equal(reloaded.status, 'pending', 'order stays pending — nothing was cancelled');
      assert.equal(reloaded.stockRestored, false);
    });
  });

  // ---- B1 -----------------------------------------------------------------
  describe('B1 — cart mutations during checkout', () => {
    it('rejects every cart mutation while a checkout claim is active', async () => {
      const fixture = await makeFixture({ stock: 5 });
      const second = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await CartModel.updateOne(
        { user: fixture.user._id },
        { $set: { checkoutInProgress: new Date() } },
      ).exec();

      const expectBusy = async (operation: Promise<unknown>) => {
        await assert.rejects(operation, (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'CHECKOUT_IN_PROGRESS');
          return true;
        });
      };

      await expectBusy(addItem(fixture.user._id, second.toString(), 1));
      await expectBusy(updateItem(fixture.user._id, fixture.variant.toString(), 2));
      await expectBusy(removeItem(fixture.user._id, fixture.variant.toString()));
      await expectBusy(clearCart(fixture.user._id));
      await expectBusy(mergeGuestItems(fixture.user._id, [{ variantId: second.toString(), quantity: 1 }]));

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.ok(cart);
      assert.equal(cart.items.length, 1, 'cart unchanged while checkout is in progress');
      assert.equal(cart.items[0]?.quantity, 1);
    });

    it('accepts mutations once the claim is stale (crashed checkout recovery)', async () => {
      const fixture = await makeFixture({ stock: 5 });
      const second = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      await CartModel.updateOne(
        { user: fixture.user._id },
        {
          $set: {
            checkoutInProgress: new Date(Date.now() - CHECKOUT_CLAIM_STALE_MS - 5_000),
            version: 0,
          },
        },
      ).exec();

      const view = await addItem(fixture.user._id, second.toString(), 1);
      assert.equal(view.items.length, 2);

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.version, 1, 'version bumped by the successful mutation');
    });

    it('never loses an item added concurrently with checkout', async () => {
      for (let round = 0; round < 5; round += 1) {
        await resetDatabase();
        const fixture = await makeFixture({ stock: 5 });
        const concurrent = await addSecondVariant(fixture, 5);
        await addItem(fixture.user._id, fixture.variant.toString(), 1);

        const [orderResult, addResult] = await Promise.allSettled([
          placeOrder(fixture.user),
          addItem(fixture.user._id, concurrent.toString(), 1),
        ]);

        if (addResult.status === 'rejected') {
          assert.ok(addResult.reason instanceof AppError);
          assert.equal(addResult.reason.code, 'CHECKOUT_IN_PROGRESS');
        }

        const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
        const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();

        const cartQty = (variant: Types.ObjectId): number =>
          cart?.items
            .filter((item) => item.variant.equals(variant))
            .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
        const orderQty = (variant: Types.ObjectId): number =>
          orders
            .flatMap((order) => order.items)
            .filter((item) => item.variant.equals(variant))
            .reduce((sum, item) => sum + item.quantity, 0);

        // The original line is accounted exactly once: in the order or still in the cart.
        assert.equal(cartQty(fixture.variant) + orderQty(fixture.variant), 1);

        if (addResult.status === 'fulfilled') {
          assert.equal(
            cartQty(concurrent) + orderQty(concurrent),
            1,
            'a concurrently added item survives in the cart or the order',
          );
        }

        if (orderResult.status === 'fulfilled') {
          assert.equal(orders.length, 1);
          assert.equal(cart?.items.length ?? 0, addResult.status === 'fulfilled' ? cartQty(concurrent) : 0);
        }

        for (const variant of await VariantModel.find({
          _id: { $in: [fixture.variant, concurrent] },
        })
          .lean()
          .exec()) {
          assert.ok(variant.stock >= 0, 'stock never goes negative');
        }
      }
    });

    it('replays a checkoutId without a second order or stock decrement', async () => {
      const fixture = await makeFixture({ stock: 8 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const checkoutId = randomUUID();
      const first = await placeOrder(fixture.user, checkoutId);
      const second = await placeOrder(fixture.user, checkoutId);

      assert.equal(first.id, second.id);
      assert.equal(await OrderModel.countDocuments({ checkoutId }).exec(), 1);
      assert.equal(await stockOf(fixture.variant), 6, 'stock decremented exactly once');
    });
  });

  // ---- B2 -----------------------------------------------------------------
  describe('B2 — first cart creation race', () => {
    it('creates exactly one cart for many concurrent first requests', async () => {
      const tag = unique('race');
      const user = await UserModel.create({
        email: `${tag}@example.com`,
        name: 'Race User',
        role: 'customer',
      });

      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => getCart(user._id)),
      );

      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(
        rejected.length,
        0,
        `no first-cart request may fail: ${rejected
          .map((result) => String((result as PromiseRejectedResult).reason))
          .join(' | ')}`,
      );
      assert.equal(await CartModel.countDocuments({ user: user._id }).exec(), 1);
      for (const result of results) {
        assert.equal(result.status, 'fulfilled');
        if (result.status === 'fulfilled') {
          assert.deepEqual(result.value.items, []);
        }
      }
    });

    it('keeps carts isolated per user', async () => {
      const first = await makeFixture({ stock: 3 });
      const second = await makeFixture({ stock: 3 });
      await addItem(first.user._id, first.variant.toString(), 2);

      const firstCart = await CartModel.findOne({ user: first.user._id }).lean().exec();
      const secondCart = await CartModel.findOne({ user: second.user._id }).lean().exec();

      assert.equal(secondCart, null, 'another user has no cart until they use one');
      assert.equal(firstCart?.items.length, 1);
      const secondView = await getCart(second.user._id);
      assert.deepEqual(secondView.items, []);
    });
  });

  // ---- B3 -----------------------------------------------------------------
  describe('B3 — checkout rejects unorderable lines', () => {
    const expectNotOrderable = async (promise: Promise<unknown>, pattern: RegExp) => {
      await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'CART_NOT_ORDERABLE');
        assert.equal(error.statusCode, 409);
        const details = error.details as Array<{ path: string; message: string }> | undefined;
        assert.ok(Array.isArray(details) && details.length > 0, 'per-line details are returned');
        assert.match(details[0]?.message ?? '', pattern);
        return true;
      });
    };

    it('rejects an archived variant and leaves the cart and stock untouched', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await VariantModel.updateOne(
        { _id: fixture.variant },
        { $set: { archivedAt: new Date() } },
      ).exec();

      await expectNotOrderable(placeOrder(fixture.user), /no longer sold/);

      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 5);
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1, 'cart is preserved for the shopper to fix');
      assert.equal(cart?.checkoutInProgress, null, 'claim released after the failure');
    });

    it('rejects a product that is no longer published', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await ProductModel.updateOne({ _id: fixture.product }, { $set: { status: 'draft' } }).exec();

      await expectNotOrderable(placeOrder(fixture.user), /not available/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
    });

    it('rejects a quantity above stock with the available amount', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 3);
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { stock: 1 } }).exec();

      await expectNotOrderable(placeOrder(fixture.user), /only 1 left in stock/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 1);
    });

    it('rejects a line without a usable price instead of creating a ৳0 order', async () => {
      const fixture = await makeFixture({ stock: 5, basePrice: 0, price: null });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      await expectNotOrderable(placeOrder(fixture.user), /price is unavailable/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
    });

    it('rejects a cart line with a non-positive quantity', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      // Bypass schema validation to simulate corrupt/legacy data.
      await CartModel.collection.updateOne(
        { user: fixture.user._id },
        { $set: { 'items.0.quantity': 0 } },
      );

      await expectNotOrderable(placeOrder(fixture.user), /quantity is not valid/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 5);
    });

    it('still places a valid COD order with server-computed prices', async () => {
      const fixture = await makeFixture({ stock: 5, basePrice: 10000, price: 12000 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const order = await placeOrder(fixture.user);

      assert.equal(order.status, 'pending');
      assert.equal(order.paymentMethod, 'cod');
      assert.equal(order.items.length, 1);
      assert.equal(order.items[0]?.unitPrice, 12000, 'variant price override wins');
      assert.equal(order.subtotal, 24000);
      assert.equal(order.total, 24000);
      assert.equal(order.items[0]?.sku, fixture.sku, 'snapshot keeps the SKU');
      assert.equal(order.items[0]?.name.startsWith('Product '), true);
      assert.equal(await stockOf(fixture.variant), 3);

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 0, 'cart cleared after checkout');
    });
  });

  // ---- Transaction atomicity / claim recovery -----------------------------
  describe('A1/B1 — transaction failure and claim recovery', () => {
    type CreateFn = typeof OrderModel.create;

    /** Test seam: make the order insert fail after the stock decrements. */
    const failOrderInsert = (): (() => void) => {
      const original = OrderModel.create.bind(OrderModel);
      (OrderModel as unknown as { create: CreateFn }).create = (() => {
        throw new Error('forced order insert failure');
      }) as unknown as CreateFn;
      return () => {
        (OrderModel as unknown as { create: CreateFn }).create = original as unknown as CreateFn;
      };
    };

    it('rolls the whole checkout back when the order insert fails after the decrement', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const restore = failOrderInsert();
      try {
        await assert.rejects(placeOrder(fixture.user), /forced order insert failure/);
      } finally {
        restore();
      }

      assert.equal(await stockOf(fixture.variant), 5, 'the stock decrement was rolled back');
      assert.equal(await OrderModel.countDocuments().exec(), 0, 'no partial order was written');
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1, 'cart is untouched');
      assert.equal(cart?.checkoutInProgress, null, 'claim released after the failure');

      // Recovery: an immediate retry succeeds with the correct stock delta.
      const order = await placeOrder(fixture.user);
      assert.equal(order.items.length, 1);
      assert.equal(await stockOf(fixture.variant), 3);
    });

    it('restores stock exactly once and rejects a second cancellation', async () => {
      const fixture = await makeFixture({ stock: 6 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 5);

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 6);

      await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 6, 'no second restore');

      const reloaded = await OrderModel.findById(order.id).lean().exec();
      assert.equal(reloaded?.stockRestored, true);
    });
  });

  // ---- Concurrency between order lifecycle and catalog changes -------------
  describe('A5 — checkout/cancel racing a variant deletion', () => {
    it('keeps the invariant when a cancellation and a deletion race', async () => {
      const fixture = await makeFixture({ stock: 6 });
      const sibling = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 4);

      const [cancelResult] = await Promise.allSettled([
        cancelOrder(fixture.user, order.id),
        deleteVariant(fixture.variant.toString()),
      ]);

      const reloadedOrder = await OrderModel.findById(order.id).lean().exec();
      const variant = await VariantModel.findById(fixture.variant).lean().exec();

      if (cancelResult.status === 'fulfilled') {
        assert.equal(reloadedOrder?.status, 'cancelled');
        assert.equal(reloadedOrder?.stockRestored, true);
        assert.ok(variant, 'a variant referenced by an order is never hard-deleted');
        assert.ok(variant?.archivedAt instanceof Date);
        assert.equal(variant?.stock, 6, 'stock restored exactly once');
      } else {
        assert.ok(cancelResult.reason instanceof AppError);
        assert.equal(reloadedOrder?.status, 'pending');
        assert.equal(reloadedOrder?.stockRestored, false);
        if (variant) {
          assert.equal(variant.stock, 4, 'no partial restore');
        }
      }
      assert.equal(await stockOf(sibling), 5, 'unrelated variant untouched');
    });

    it('never commits an order that references a deleted variant', async () => {
      for (let round = 0; round < 4; round += 1) {
        await resetDatabase();
        const fixture = await makeFixture({ stock: 3 });
        await addSecondVariant(fixture, 3); // keeps the last-variant rule out of the way
        await addItem(fixture.user._id, fixture.variant.toString(), 1);

        const [orderResult, deleteResult] = await Promise.allSettled([
          placeOrder(fixture.user),
          deleteVariant(fixture.variant.toString()),
        ]);

        const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();
        const variant = await VariantModel.findById(fixture.variant).lean().exec();

        if (orders.length > 0) {
          assert.equal(orderResult.status, 'fulfilled');
          assert.ok(variant, 'a committed order must keep its variant document');
          assert.ok(variant?.archivedAt instanceof Date, 'and that variant is archived');
          assert.equal(variant?.stock, 2, 'decremented exactly once');
          assert.equal(orders[0]?.items[0]?.variant.toString(), fixture.variant.toString());
        } else {
          assert.equal(orderResult.status, 'rejected');
          assert.equal(deleteResult.status, 'fulfilled');
          assert.equal(variant, null, 'no order → the deletion may win and remove it');
        }
        if (variant) {
          assert.ok(variant.stock >= 0, 'stock never negative');
        }
      }
    });
  });

  // ---- Duplicate-key policy ------------------------------------------------
  describe('B2 — duplicate-key policy', () => {
    it('does not suppress unrelated errors and rethrows an unrecoverable duplicate key', async () => {
      const user = await UserModel.create({
        email: `${unique('b2')}@example.com`,
        name: 'B2 User',
        role: 'customer',
      });
      type InsertFn = typeof CartModel.findOneAndUpdate;
      const original = CartModel.findOneAndUpdate.bind(CartModel);

      const patchInsert = (error: unknown): void => {
        (CartModel as unknown as { findOneAndUpdate: InsertFn }).findOneAndUpdate = (() => ({
          exec: async () => {
            throw error;
          },
        })) as unknown as InsertFn;
      };
      const restore = (): void => {
        (CartModel as unknown as { findOneAndUpdate: InsertFn }).findOneAndUpdate =
          original as unknown as InsertFn;
      };

      try {
        patchInsert(Object.assign(new Error('boom'), { code: 121 }));
        await assert.rejects(getCart(user._id), /boom/);

        patchInsert(Object.assign(new Error('dup'), { code: 11000 }));
        await assert.rejects(getCart(user._id), /dup/);
      } finally {
        restore();
      }

      // The real race path still recovers: the competing cart exists.
      await CartModel.create({ user: user._id, items: [] });
      const view = await getCart(user._id);
      assert.deepEqual(view.items, []);
      assert.equal(await CartModel.countDocuments({ user: user._id }).exec(), 1);
    });
  });
});

```

---

## 2. New file: `server/test/README.md` (61 lines)

```markdown
# Server tests (Phase 0)

`node:test` + `tsx` (already a dev dependency — nothing new to install).

## Run

```bash
# Unit tests only (no database needed)
npm run test:unit

# Integration + concurrency tests (requires a DISPOSABLE replica set)
MONGODB_TEST_URI="mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true" npm run test:db

# Everything
npm test
```

PowerShell:

```powershell
$env:MONGODB_TEST_URI = 'mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true'
npm run test:db
```

Without `MONGODB_TEST_URI` the integration suite is **skipped** with an explicit reason — it never silently passes.

## Requirements

- MongoDB **replica set** (transactions are mandatory). The suite asserts the
  capability in `before()` and fails with the detected topology otherwise.
- A database that may be **wiped**: `beforeEach` deletes every document in every
  collection it touches.
- Never point `MONGODB_TEST_URI` at production. Use a separate port/database, e.g.:

```bash
mongod --replSet rs0 --port 27018 --dbpath ./.p0-test-data
mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"
```

## What is covered

| Area | File |
|---|---|
| A1 — deployment capability classification (pure) | `mongo-capabilities.test.ts` |
| A1 — startup guard: standalone rejected, replica set accepted | `topology-guard.test.ts` |
| A1/B1 — cart version compare-and-swap filter (pure) | `checkout-version-filter.test.ts` |
| A5 — variant archive/delete, stock restore, cancellation abort, races | `order-integrity.test.ts` |
| B1 — cart mutations vs. checkout claim, concurrent add, replay, rollback/recovery | `order-integrity.test.ts` |
| B2 — first-cart upsert race, per-user isolation, duplicate-key policy | `order-integrity.test.ts` |
| B3 — archived/unpublished/out-of-stock/priceless/invalid-quantity lines, valid COD order | `order-integrity.test.ts` |

`MONGODB_STANDALONE_URI` is optional; when set, the A1 guard test proves that a plain `mongod`
(no `--replSet`) is refused at startup. Start one alongside the replica set:

```bash
mongod --port 27019 --dbpath ./.p0-standalone-data
```

Client-side A4 tests run with the built-in Node test runner (no dependencies):
`cd client && npm test`.

```

---

## 2. New file: `client/lib/site-url.ts` (91 lines)

```ts
/**
 * Public-origin resolution for metadata, canonicals, OpenGraph, robots and the
 * sitemap. Pure on purpose (no framework imports) so it is unit-testable and can
 * run both at build time and at runtime.
 *
 * Production builds must provide an explicit absolute **https** URL that is not a
 * loopback host. Silently falling back to `http://localhost:3000` would publish
 * localhost canonicals to search engines — the exact failure this guard exists
 * to prevent. Development keeps the convenient localhost default.
 */

export interface SiteUrlInputs {
  /** NEXT_PUBLIC_SITE_URL as provided by the environment. */
  raw?: string | undefined;
  /** NODE_ENV. */
  nodeEnv?: string | undefined;
  /** VERCEL_ENV ("production" | "preview" | "development") when on Vercel. */
  vercelEnv?: string | undefined;
  /** VERCEL_URL (hostname only, no protocol) when on Vercel. */
  vercelUrl?: string | undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
};

const parseAbsoluteUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const REQUIREMENT =
  'Set NEXT_PUBLIC_SITE_URL to the public origin (for example https://abstract-lifestyle.vercel.app) before building for production.';

/**
 * Resolves the public origin or throws with an actionable message.
 *
 * - production (NODE_ENV=production, not a Vercel preview): must be absolute
 *   https and must not point at a loopback host;
 * - Vercel preview without an explicit value: falls back to VERCEL_URL (https);
 * - development/test: localhost default is allowed.
 */
export const resolveSiteUrl = (inputs: SiteUrlInputs): URL => {
  const raw = (inputs.raw ?? '').trim();
  const vercelEnv = (inputs.vercelEnv ?? '').trim();
  const strict = inputs.nodeEnv === 'production' && vercelEnv !== 'preview';

  if (raw.length > 0) {
    const parsed = parseAbsoluteUrl(raw);
    if (!parsed) {
      throw new Error(
        `NEXT_PUBLIC_SITE_URL must be an absolute URL (received "${raw}"). ${REQUIREMENT}`,
      );
    }
    if (strict) {
      if (parsed.protocol !== 'https:') {
        throw new Error(
          `NEXT_PUBLIC_SITE_URL must use https in production (received "${parsed.protocol}//"). ${REQUIREMENT}`,
        );
      }
      if (isLoopbackHostname(parsed.hostname)) {
        throw new Error(
          `NEXT_PUBLIC_SITE_URL must not point at a local host in production (received "${parsed.hostname}"). ${REQUIREMENT}`,
        );
      }
    }
    return parsed;
  }

  if (strict) {
    throw new Error(`NEXT_PUBLIC_SITE_URL is required in production. ${REQUIREMENT}`);
  }

  // Preview deployments get their own https origin instead of localhost.
  const vercelUrl = (inputs.vercelUrl ?? '').trim();
  if (vercelEnv === 'preview' && vercelUrl.length > 0) {
    const withProtocol = /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
    const parsed = parseAbsoluteUrl(withProtocol);
    if (parsed && parsed.protocol === 'https:' && !isLoopbackHostname(parsed.hostname)) {
      return parsed;
    }
  }

  return new URL('http://localhost:3000');
};
```

---

## 2. New file: `client/lib/__tests__/site-url.test.ts` (118 lines)

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isLoopbackHostname, resolveSiteUrl } from '../site-url.ts';

const PROD = { nodeEnv: 'production' as const };

describe('A4 — public site URL guard', () => {
  it('accepts an explicit https origin in production', () => {
    const url = resolveSiteUrl({ ...PROD, raw: 'https://abstract-lifestyle.vercel.app' });
    assert.equal(url.origin, 'https://abstract-lifestyle.vercel.app');
  });

  it('rejects a missing value in production', () => {
    assert.throws(() => resolveSiteUrl({ ...PROD }), /NEXT_PUBLIC_SITE_URL is required/);
  });

  it('rejects localhost in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'http://localhost:3000' }),
      /must use https in production/,
    );
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://localhost:3000' }),
      /must not point at a local host/,
    );
  });

  it('rejects loopback IPs in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://127.0.0.1' }),
      /must not point at a local host/,
    );
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://[::1]:3000' }),
      /must not point at a local host/,
    );
  });

  it('rejects plain http in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'http://abstract-lifestyle.vercel.app' }),
      /must use https in production/,
    );
  });

  it('rejects a relative/non-absolute value everywhere', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'abstract-lifestyle.vercel.app' }),
      /must be an absolute URL/,
    );
    assert.throws(
      () => resolveSiteUrl({ nodeEnv: 'development', raw: '/products' }),
      /must be an absolute URL/,
    );
  });

  it('allows localhost in development and defaults to it', () => {
    assert.equal(resolveSiteUrl({ nodeEnv: 'development' }).origin, 'http://localhost:3000');
    assert.equal(
      resolveSiteUrl({ nodeEnv: 'development', raw: 'http://localhost:3000' }).origin,
      'http://localhost:3000',
    );
  });

  it('uses the Vercel preview origin when no explicit value is set', () => {
    const url = resolveSiteUrl({
      nodeEnv: 'production',
      vercelEnv: 'preview',
      vercelUrl: 'abstract-lifestyle-git-branch.vercel.app',
    });
    assert.equal(url.origin, 'https://abstract-lifestyle-git-branch.vercel.app');
  });

  it('accepts an explicit https value on preview deployments', () => {
    const url = resolveSiteUrl({
      nodeEnv: 'production',
      vercelEnv: 'preview',
      raw: 'https://abstract-lifestyle-git-branch.vercel.app',
    });
    assert.equal(url.origin, 'https://abstract-lifestyle-git-branch.vercel.app');
  });

  it('classifies loopback hosts', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '0.0.0.0', '::1', 'app.localhost']) {
      assert.equal(isLoopbackHostname(host), true, host);
    }
    for (const host of ['abstract-lifestyle.vercel.app', 'example.com', '10.0.0.5']) {
      assert.equal(isLoopbackHostname(host), false, host);
    }
  });
});

describe('A4 — consumers use the guarded origin', () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), 'utf8');

  it('seo.ts resolves SITE_URL through resolveSiteUrl and derives absoluteUrl from it', () => {
    const source = read('../seo.ts');
    assert.match(source, /resolveSiteUrl\(/);
    assert.match(source, /export const SITE_URL/);
    assert.match(source, /export const absoluteUrl/);
    assert.doesNotMatch(source, /'http:\/\/localhost:3000'/);
  });

  it('canonical/OG metadata, robots and sitemap all import from lib/seo', () => {
    for (const file of ['../../app/layout.tsx', '../../app/sitemap.ts', '../../app/robots.ts']) {
      const source = read(file);
      assert.match(source, /@\/lib\/seo/, `${file} must use the guarded SEO helpers`);
    }
  });

  it('builds absolute canonical/robots/sitemap URLs from the resolved origin', () => {
    const origin = resolveSiteUrl({ ...PROD, raw: 'https://abstract-lifestyle.vercel.app' });
    assert.equal(new URL('/sitemap.xml', origin).toString(), 'https://abstract-lifestyle.vercel.app/sitemap.xml');
    assert.equal(new URL('/products/mens-pant', origin).toString(), 'https://abstract-lifestyle.vercel.app/products/mens-pant');
  });
});
```


---

## Final corrective snapshot (2026-11-17)

Branch `fix/audit-p0-order-integrity`, baseline/HEAD `f39ac2a`; uncommitted. 73 server + 19 client tests pass. Private env files, audit documents, dependencies and generated artifacts excluded.

### Final tracked diff

```diff
diff --git a/API_DOCUMENTATION.md b/API_DOCUMENTATION.md
index 0694832..9aec53d 100644
--- a/API_DOCUMENTATION.md
+++ b/API_DOCUMENTATION.md
@@ -35,7 +35,7 @@ Codes: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_F
 | GET /products/sitemap | — | 200 `{ items: [{ slug, updatedAt }] }` — active product slugs for the client sitemap (capped at 5000, no catalog payload) |
 | GET /products/:slug | — | 200 `{ product, variants: [Variant], sizeGuideKey: 'clothing' \| null }` |
 | GET /site-images | — | 200 `{ items: [{ key, image }] }` — storefront marketing slots (`hero`, `promo-1`, `promo-2`); `image` = `{ url, publicId }` or `null` when empty |
-| GET /health | — | 200 `{ ok: true }` |
+| GET /health | — | 200 `{ ok: true, transactions: true }` — `transactions` reflects the connected deployment's ability to run order transactions; the API refuses to start without it |
 
 ProductCard: `{ id, name, slug, category, image, priceFrom, priceTo, sizes[], colors[], inStock, compareAtPrice, discountPercent, createdAt }` (`compareAtPrice` = original price applying to `priceFrom`, `null` = no sale; `discountPercent` = server-computed floor %, always `0` unless the compare-at is strictly greater than the price; `createdAt` = ISO 8601 creation timestamp used for the "New" badge)
 Variant: `{ id, sku, size, color, price (effective), compareAtPrice, discountPercent, stock, inStock, lowStock, images[] }` (`lowStock` = stock ≤ lowStockThreshold and > 0). Compare-at rule: a variant **with its own price** uses only its own `compareAtPrice` (none = no sale); a variant **without its own price** uses the product `compareAtPrice`.
@@ -45,7 +45,7 @@ Product (detail): `{ id, name, slug, description, category, basePrice, compareAt
 | Endpoint | Request | Response |
 |---|---|---|
 | GET /cart | — | 200 `{ items: [{ variantId, product, name, sku, size, color, image, unitPrice, quantity, lineTotal, outOfStock, insufficientStock, unavailable }], subtotal, shippingFee, total }` |
-| POST /cart/items | `{ variantId, quantity (1–20) }` | 200 cart — existing line's quantity increases, capped at available stock |
+| POST /cart/items | `{ variantId, quantity (1–20) }` | 200 cart — existing line's quantity increases, capped at available stock; 409 `CHECKOUT_IN_PROGRESS` while another checkout holds the cart claim |
 | PATCH /cart/items/:variantId | `{ quantity (1–20) }` | 200 cart — capped at available stock |
 | DELETE /cart/items/:variantId | — | 200 cart (idempotent) |
 | DELETE /cart | — | 200 cart — removes all items |
@@ -56,7 +56,7 @@ Cart notes: prices/stock are always recomputed from the DB (`unitPrice = variant
 ## Orders (customer)
 | Endpoint | Request | Response |
 |---|---|---|
-| POST /orders | `{ checkoutId (UUID), shippingAddressId }` OR `{ checkoutId, shippingAddress: {...} }`, `paymentMethod: 'cod'` | 201 `{ order }`; 409 on insufficient stock / empty cart / in-progress checkout. Idempotent: replaying the same `checkoutId` returns the existing order |
+| POST /orders | `{ checkoutId (UUID), shippingAddressId }` OR `{ checkoutId, shippingAddress: {...} }`, `paymentMethod: 'cod'` | 201 `{ order }`; 409 `CART_NOT_ORDERABLE` (with per-line `details[]`) when any line is archived/unpublished/out of stock/priceless, 409 `CHECKOUT_IN_PROGRESS`, 409 `CHECKOUT_CONFLICT` when the cart changed mid-checkout. Idempotent: replaying the same `checkoutId` returns the existing order |
 | GET /orders | `?page&limit` | 200 list envelope (own orders, newest first) |
 | GET /orders/:id | — | 200 `{ order }` (own or admin) |
 | POST /orders/:id/cancel | — | 200 `{ order }` — customer cancel only from `pending`; restores stock exactly once (double-cancel safe); 409 otherwise |
@@ -79,7 +79,8 @@ Order JSON: `{ id, orderNumber, checkoutId, status, paymentMethod, paymentStatus
 | PATCH /admin/variants/:id | partial, plus optional `expectedStock` | 200 `{ variant }` — stock edits are compare-and-set on `expectedStock` (409 when an order changed the stock meanwhile) |
 
 Sale pricing (admin): `POST/PATCH /admin/products` accept `compareAtPrice` (integer poisha; `null` clears it) and `variants` endpoints accept `compareAtPrice` (only used when the variant has its own `price`). A variant WITH its own price uses only its own compare-at (none = no sale); a variant WITHOUT its own price uses the product compare-at. Setting a compare-at that is not greater than the price returns 400 - Compare-at price must be greater than the price. Raising a price to or above the stored compare-at returns 400 - Price must be lower than the compare-at price. Clear or raise the compare-at price first. Public DTOs always return `discountPercent: 0` when the compare-at is not strictly greater than the price, so stale values never render a discount.
-| DELETE /admin/variants/:id | — | 204 (409 if it is the product's last variant) |
+| DELETE /admin/variants/:id | — | 204 hard delete (409 if it is the product's last purchasable variant); **200 `{ archived: true, orders: N }` when N orders reference the variant** — the document and its stock are retained so cancellations can restore inventory |
+| PATCH /admin/variants/:id/restore | — | Admin only. 200 `{ variant }`; restores the existing document, preserving id/SKU/stock/history. Repeated restore succeeds. Parent status is unchanged; 409 on missing parent or uniqueness/concurrency conflict; 404 on missing variant. |
 | GET /admin/variants | `?lowStock=true&page&limit` | 200 list envelope (variant + product ref + `inStock`/`lowStock` flags) |
 | POST /admin/uploads | multipart `images[]` (jpeg/png/webp/heic/avif/bmp/tiff by content, ≤ 5 MB each, max 10) | 201 `{ assets: [{ url, publicId }] }` — content-verified (magic bytes) then uploaded to Cloudinary (`abstract-lifestyle/products`, cloud-generated public_id); HEIC/AVIF/BMP/TIFF are converted to JPEG on upload; `url` is the secure https URL |
 | POST /admin/uploads/destroy | `{ publicIds: string[] }` (1–20, own folder only) | 204 — deletes assets that were uploaded but never attached to a saved product (best-effort) |
diff --git a/DEPLOYMENT.md b/DEPLOYMENT.md
index 9324c1a..a2b69e3 100644
--- a/DEPLOYMENT.md
+++ b/DEPLOYMENT.md
@@ -30,7 +30,7 @@ each section before exposing the store to real customers.
 | Variable | Production requirement |
 |---|---|
 | `API_URL` | Internal/public origin the Next.js server uses to reach the API (e.g. `http://127.0.0.1:4000` on one host) |
-| `NEXT_PUBLIC_SITE_URL` | Public storefront origin (used by metadata, `robots.txt`, `sitemap.xml`) |
+| `NEXT_PUBLIC_SITE_URL` | Public storefront origin, used by metadata, canonical/OpenGraph URLs, `robots.txt` and `sitemap.xml`. **Required for production builds and local `next start`**, with an absolute `https` origin that is not a loopback host (e.g. `https://abstract-lifestyle.vercel.app`). Vercel preview builds enforce the same validation; when unset they require a valid HTTPS `VERCEL_URL` instead. Normal development allows localhost. |
 | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Identity Services client id (public by design — it configures the hosted Google button) |
 
 ### Vercel (client)
@@ -55,6 +55,19 @@ The `--include=dev` flag is required: `NODE_ENV=production` (set as a service en
 
 Set the **server** env table above (Production) in the Render dashboard; `TRUST_PROXY=1` is mandatory (Render proxies all traffic) and `PORT` is injected by Render — do not set it. Allow Render's outbound IPs in MongoDB Atlas Network Access. After the first deploy, run the seed once (`npm run seed:prod -- --admin-only`, or locally against the prod `MONGODB_URI`) unless the database is already seeded. Finally set `API_URL` in Vercel to the Render service URL (`https://<name>.onrender.com`) and redeploy the Vercel project; set `CLIENT_ORIGIN` on Render to the Vercel origin.
 
+### Local database (replica set required)
+
+Order checkout, cancellation and admin variant/product deletion use multi-document transactions. The API **refuses to start** against a standalone `mongod` and prints the fix. Run a single-node replica set locally:
+
+```bash
+mongod --replSet rs0 --dbpath ./data --port 27017
+mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
+```
+
+Then use `MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0&directConnection=true` (see `server/.env.example`). Managed MongoDB (Atlas, Render, etc.) already runs a replica set. `GET /api/health` reports `{ ok, transactions }` so a wrong topology is visible.
+
+Integration tests need a **disposable** replica set; see `server/test/README.md`. Never point them at production.
+
 - [ ] Every variable above is set from the host's secret manager — never committed to the repo
 - [ ] `server/.env.example` and `client/.env.example` list every variable used in code
 - [ ] `git grep -I "mongodb+srv"`, `git grep "JWT_SECRET="` etc. show only placeholders
diff --git a/PROJECT_CONTEXT.md b/PROJECT_CONTEXT.md
index 2d60ead..fb0b37b 100644
--- a/PROJECT_CONTEXT.md
+++ b/PROJECT_CONTEXT.md
@@ -68,7 +68,7 @@ Business logic lives only in /server. Next.js never duplicates backend logic; it
 | Shipping cost | Flat fee from `SHIPPING_FEE` env (integer poisha, default 0); no carrier integration |
 | Size guide | Static clothing size-chart component (not DB-managed) |
 | Products without options | Every product has ≥ 1 variant; no-option lifestyle products get one "default" variant (size/color = null) |
-| Stock decrement | Guarded atomic `findOneAndUpdate` + compensating rollback; no transactions (works on standalone Mongo) |
+| Stock decrement | Guarded atomic `findOneAndUpdate` inside a MongoDB **transaction** (replica set required); the API refuses to start on a standalone deployment |
 | Order cancellation | Only from pending/processing; stock restored once (guarded by `stockRestored`) |
 | Auth transport | Browser talks to same-origin `/api/*` via Next.js rewrites → Express; `cors` kept locked to `CLIENT_ORIGIN` as a safety net for direct access |
 | Auth token storage | JWT in **httpOnly cookie** (`al_token`): `httpOnly: true`, `sameSite: 'lax'`, `secure: true` in production (off over local http), `maxAge` = JWT expiry (7d) |
@@ -99,7 +99,7 @@ Business logic lives only in /server. Next.js never duplicates backend logic; it
 - Rate limiting (`express-rate-limit`) on auth endpoints.
 
 ## 9. Risks
-- **Stock without transactions:** multi-item orders use compensating rollback on standalone Mongo (small race window). Upgrade path: replica set + transactions.
+- **Transactions require a replica set:** checkout, cancellation and variant/product deletion use multi-document transactions, so the deployment must be a replica set or sharded cluster (Atlas is). A standalone `mongod` is rejected at startup with a diagnostic. Order cancellation aborts if a referenced variant is missing instead of reporting a false success; variants referenced by orders are archived (kept for history) rather than deleted.
 - **Dependency policy:** approved list only (§7); anything else (e.g. helmet) asks first.
 - **Local disk uploads** don't scale to multi-instance deploys (swap to cloud storage later).
 - **Text search** won't match partial words (e.g. "t-shi" misses "T-shirt").
diff --git a/client/.env.example b/client/.env.example
index 8850f39..3805c21 100644
--- a/client/.env.example
+++ b/client/.env.example
@@ -9,8 +9,13 @@
 API_URL=http://localhost:4000
 
 # Public origin of the storefront — used for metadata (metadataBase, Open Graph),
-# robots.txt and sitemap.xml. Default when unset: http://localhost:3000
-NEXT_PUBLIC_SITE_URL=http://localhost:3000
+# robots.txt and sitemap.xml.
+# Production builds REQUIRE this value: an absolute https origin that is not a
+# loopback host, otherwise the build fails fast instead of shipping localhost
+# canonicals. In development the localhost default below is fine.
+# Preview builds enforce the same https/non-loopback checks; when unset they
+# require a valid https VERCEL_URL. Local next start also uses production rules.
+NEXT_PUBLIC_SITE_URL=https://abstract-lifestyle.vercel.app
 
 # Cloudinary cloud name (PUBLIC — it appears in every image URL). Used only to
 # restrict next/image remotePatterns to your cloud. The API key/secret live in
diff --git a/client/components/admin/VariantManager.tsx b/client/components/admin/VariantManager.tsx
index 3ac167c..61eee40 100644
--- a/client/components/admin/VariantManager.tsx
+++ b/client/components/admin/VariantManager.tsx
@@ -379,9 +379,17 @@ export function VariantManager({
     setNotice(null);
     void (async () => {
       try {
-        await adminApi.deleteVariant(deleteTarget.id);
+        const result = await adminApi.deleteVariant(deleteTarget.id);
         await reload();
-        setNotice({ tone: 'success', message: `Variant ${deleteTarget.sku} deleted.` });
+        if (result?.archived) {
+          const orders = result.orders ?? 0;
+          setNotice({
+            tone: 'info',
+            message: `Variant ${deleteTarget.sku} is used by ${orders} order${orders === 1 ? '' : 's'}, so it was archived instead of deleted. It keeps its stock for cancellations and no longer appears on the storefront.`,
+          });
+        } else {
+          setNotice({ tone: 'success', message: `Variant ${deleteTarget.sku} deleted.` });
+        }
       } catch (error) {
         setNotice({
           tone: 'error',
@@ -397,6 +405,31 @@ export function VariantManager({
     })();
   };
 
+  const handleRestore = (variant: AdminVariant) => {
+    setBusy(true);
+    setNotice(null);
+    void (async () => {
+      try {
+        await adminApi.restoreVariant(variant.id);
+        await reload();
+        setNotice({
+          tone: 'success',
+          message: `Variant ${variant.sku} restored with its original SKU and stock.`,
+        });
+      } catch (error) {
+        setNotice({
+          tone: 'error',
+          message:
+            error instanceof ApiError
+              ? error.message
+              : 'Could not restore this variant. Reload and try again.',
+        });
+      } finally {
+        setBusy(false);
+      }
+    })();
+  };
+
   const startEdit = (variant: AdminVariant) => {
     setEditingId(variant.id);
     setEditValues(toFormValues(variant));
@@ -597,6 +630,14 @@ export function VariantManager({
                 <tr key={variant.id} className="border-b border-line/60 last:border-0">
                   <th scope="row" className="py-2 pr-3 font-medium text-ink">
                     {variant.sku}
+                    {variant.archivedAt ? (
+                      <span
+                        className="ml-2 rounded-full border border-line bg-tile px-2 py-0.5 text-[11px] font-medium text-muted"
+                        title={`Archived ${new Date(variant.archivedAt).toLocaleDateString('en-GB')} — kept for order history`}
+                      >
+                        Archived
+                      </span>
+                    ) : null}
                   </th>
                   <td className="py-2 pr-3 text-muted">
                     {[variant.size, variant.color].filter(Boolean).join(' / ') || '—'}
@@ -619,9 +660,25 @@ export function VariantManager({
                   </td>
                   <td className="py-2">
                     <div className="flex gap-2">
-                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => startEdit(variant)}>
-                        Edit
-                      </Button>
+                      {variant.archivedAt ? (
+                        <Button
+                          variant="secondary"
+                          size="sm"
+                          disabled={busy}
+                          onClick={() => handleRestore(variant)}
+                        >
+                          Restore
+                        </Button>
+                      ) : (
+                        <Button
+                          variant="ghost"
+                          size="sm"
+                          disabled={busy}
+                          onClick={() => startEdit(variant)}
+                        >
+                          Edit
+                        </Button>
+                      )}
                       <Button
                         variant="ghost"
                         size="sm"
diff --git a/client/components/checkout/CheckoutClient.tsx b/client/components/checkout/CheckoutClient.tsx
index efcf562..138173e 100644
--- a/client/components/checkout/CheckoutClient.tsx
+++ b/client/components/checkout/CheckoutClient.tsx
@@ -70,6 +70,7 @@ export function CheckoutClient() {
   const [formError, setFormError] = useState<string | null>(null);
   const [errorList, setErrorList] = useState<Array<{ field: keyof AddressFormValues; message: string }>>([]);
   const [conflict, setConflict] = useState<string | null>(null);
+  const [conflictDetails, setConflictDetails] = useState<string[]>([]);
   const [retryNote, setRetryNote] = useState<string | null>(null);
   const [summaryOpen, setSummaryOpen] = useState(false);
   const [reloadKey, setReloadKey] = useState(0);
@@ -207,6 +208,7 @@ export function CheckoutClient() {
     setFormError(null);
     setErrorList([]);
     setConflict(null);
+    setConflictDetails([]);
     setRetryNote(null);
 
     if (!checkoutIdRef.current) {
@@ -254,17 +256,23 @@ export function CheckoutClient() {
       router.push(`/orders/${order.id}?placed=1`);
     } catch (error) {
       if (error instanceof ApiError && error.status === 409) {
-        if (
-          error.message.includes('Item no longer available') ||
-          error.message.includes('Insufficient stock')
-        ) {
+        if (error.code === 'CART_NOT_ORDERABLE') {
+          // The server re-validated every line; show exactly what must be fixed.
           setConflict(error.message);
-        } else if (error.message.includes('Checkout already in progress')) {
+          setConflictDetails(error.details.map((detail) => detail.message));
+        } else if (error.code === 'CHECKOUT_IN_PROGRESS' || error.code === 'CHECKOUT_CONFLICT') {
           setRetryNote(
-            'Checkout is already in progress. Please wait a moment and try again.',
+            error.code === 'CHECKOUT_CONFLICT'
+              ? 'Your cart changed while the order was placed. Review it and try again.'
+              : 'Checkout is already in progress. Please wait a moment and try again.',
           );
         } else if (error.message.includes('Cart is empty')) {
           setConflict('Your cart is empty.');
+        } else if (
+          error.message.includes('Item no longer available') ||
+          error.message.includes('Insufficient stock')
+        ) {
+          setConflict(error.message);
         } else {
           setFormError(error.message);
         }
@@ -393,6 +401,13 @@ export function CheckoutClient() {
           {conflict ? (
             <Notice tone="error">
               <p>{conflict}</p>
+              {conflictDetails.length > 0 ? (
+                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
+                  {conflictDetails.map((detail) => (
+                    <li key={detail}>{detail}</li>
+                  ))}
+                </ul>
+              ) : null}
               <Button
                 variant="secondary"
                 size="sm"
diff --git a/client/lib/api/admin.ts b/client/lib/api/admin.ts
index 2562c6a..2784ad5 100644
--- a/client/lib/api/admin.ts
+++ b/client/lib/api/admin.ts
@@ -85,7 +85,13 @@ export const adminApi = {
   updateVariant: (id: string, payload: Partial<VariantPayload>) =>
     apiFetch<{ variant: AdminVariant }>(`/admin/variants/${id}`, { method: 'PATCH', body: payload }),
   deleteVariant: (id: string) =>
-    apiFetch<void>(`/admin/variants/${id}`, { method: 'DELETE' }),
+    // 204 = hard delete; 200 = archived because orders reference it.
+    apiFetch<{ archived?: boolean; orders?: number } | undefined>(`/admin/variants/${id}`, {
+      method: 'DELETE',
+    }),
+  /** Revives an archived variant (same document, same id, same SKU/stock). */
+  restoreVariant: (id: string) =>
+    apiFetch<{ variant: AdminVariant }>(`/admin/variants/${id}/restore`, { method: 'PATCH' }),
   listLowStockVariants: (limit = 10) =>
     apiFetch<ListEnvelope<AdminVariant>>(`/admin/variants?lowStock=true&page=1&limit=${limit}`),
 
diff --git a/client/lib/seo.ts b/client/lib/seo.ts
index 8f4a062..bef85ec 100644
--- a/client/lib/seo.ts
+++ b/client/lib/seo.ts
@@ -1,7 +1,19 @@
 import { site } from '@/config/site';
+import { resolveSiteUrl } from '@/lib/site-url';
 
-/** Single source of truth for the public site URL and shared SEO defaults. */
-export const SITE_URL = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000');
+/**
+ * Single source of truth for the public site URL and shared SEO defaults.
+ *
+ * `resolveSiteUrl` refuses to fall back to localhost in a production build, so a
+ * missing/misconfigured NEXT_PUBLIC_SITE_URL fails the deploy instead of shipping
+ * localhost canonicals, OpenGraph URLs, robots.txt and sitemap entries.
+ */
+export const SITE_URL = resolveSiteUrl({
+  raw: process.env.NEXT_PUBLIC_SITE_URL,
+  nodeEnv: process.env.NODE_ENV,
+  vercelEnv: process.env.VERCEL_ENV,
+  vercelUrl: process.env.VERCEL_URL,
+});
 
 export const SITE_NAME = site.name;
 
diff --git a/client/lib/types/admin.ts b/client/lib/types/admin.ts
index bda6d79..68bc88c 100644
--- a/client/lib/types/admin.ts
+++ b/client/lib/types/admin.ts
@@ -53,6 +53,8 @@ export interface AdminVariant {
   stock: number;
   lowStockThreshold: number;
   images: string[];
+  /** Set when the variant is retired (kept for order history, never sold). */
+  archivedAt: string | null;
   inStock: boolean;
   lowStock: boolean;
 }
diff --git a/client/lib/types/api.ts b/client/lib/types/api.ts
index 7a5b28d..8d12cb8 100644
--- a/client/lib/types/api.ts
+++ b/client/lib/types/api.ts
@@ -6,7 +6,15 @@ export type ApiErrorCode =
   | 'NOT_FOUND'
   | 'CONFLICT'
   | 'RATE_LIMITED'
-  | 'SERVER_ERROR';
+  | 'SERVER_ERROR'
+  /** Checkout: one or more cart lines can no longer be ordered (details[]). */
+  | 'CART_NOT_ORDERABLE'
+  /** Checkout/cart: another checkout currently holds the cart claim. */
+  | 'CHECKOUT_IN_PROGRESS'
+  /** Checkout: the cart changed while the order was being placed. */
+  | 'CHECKOUT_CONFLICT'
+  /** Cancellation: the inventory could not be restored, so nothing changed. */
+  | 'STOCK_RESTORE_FAILED';
 
 export interface ApiErrorDetail {
   path: string;
diff --git a/client/package.json b/client/package.json
index 4b68a0c..c07e2a9 100644
--- a/client/package.json
+++ b/client/package.json
@@ -7,7 +7,8 @@
     "build": "next build",
     "start": "next start",
     "lint": "eslint",
-    "type-check": "next typegen && tsc --noEmit"
+    "type-check": "next typegen && tsc --noEmit",
+    "test": "node --test lib/__tests__/site-url.test.ts"
   },
   "dependencies": {
     "next": "16.4.5",
diff --git a/client/tsconfig.json b/client/tsconfig.json
index 3a13f90..470837e 100644
--- a/client/tsconfig.json
+++ b/client/tsconfig.json
@@ -9,6 +9,7 @@
     "esModuleInterop": true,
     "module": "esnext",
     "moduleResolution": "bundler",
+    "allowImportingTsExtensions": true,
     "resolveJsonModule": true,
     "isolatedModules": true,
     "jsx": "react-jsx",
diff --git a/server/.env.example b/server/.env.example
index 0cae8e0..688bd53 100644
--- a/server/.env.example
+++ b/server/.env.example
@@ -9,8 +9,15 @@ NODE_ENV=development
 # Port the Express API listens on
 PORT=4000
 
-# MongoDB connection string (used from Task 2 onward)
-MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle
+# MongoDB connection string. Checkout, cancellation and variant/product deletion
+# use multi-document transactions, so the API requires a replica set or sharded
+# cluster (MongoDB Atlas is a replica set). A standalone mongod is rejected at
+# startup with a diagnostic.
+#
+# Local single-node replica set:
+#   mongod --replSet rs0 --dbpath ./data --port 27017
+#   mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
+MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0&directConnection=true
 
 # Secret used to sign JWTs (minimum 32 characters).
 # Generate one with:
@@ -57,3 +64,9 @@ GOOGLE_CLIENT_ID=
 # post fake credentials to POST /auth/google). Must never be set — the API
 # refuses to start when NODE_ENV=production and this is present.
 # GOOGLE_AUTH_TEST_SEAM=
+
+# Destructive integration tests only: use a disposable local replica set.
+# Both values are mandatory; no fallback to MONGODB_URI or remote opt-in exists.
+# MONGODB_TEST_MODE=disposable
+# MONGODB_TEST_URI=mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true
+# MONGODB_STANDALONE_URI=mongodb://127.0.0.1:27019/p0_standalone_test
diff --git a/server/package.json b/server/package.json
index 526a417..7d53774 100644
--- a/server/package.json
+++ b/server/package.json
@@ -15,7 +15,11 @@
     "normalize-variants": "tsx src/scripts/normalize-variants.ts",
     "normalize-variants:prod": "node dist/scripts/normalize-variants.js",
     "type-check": "tsc --noEmit",
-    "lint": "eslint ."
+    "type-check:test": "tsc --noEmit -p tsconfig.test.json",
+    "lint": "eslint .",
+    "test": "node --import tsx --test test/mongo-capabilities.test.ts test/checkout-version-filter.test.ts test/db-connect.test.ts test/test-database-guard.test.ts test/topology-guard.test.ts test/order-integrity.test.ts",
+    "test:unit": "node --import tsx --test test/mongo-capabilities.test.ts test/checkout-version-filter.test.ts test/db-connect.test.ts test/test-database-guard.test.ts",
+    "test:db": "node --import tsx --test test/test-database-guard.test.ts test/topology-guard.test.ts test/order-integrity.test.ts"
   },
   "dependencies": {
     "bcryptjs": "^3.0.3",
diff --git a/server/src/config/db.ts b/server/src/config/db.ts
index a508d69..90f79d2 100644
--- a/server/src/config/db.ts
+++ b/server/src/config/db.ts
@@ -1,12 +1,88 @@
 import mongoose from 'mongoose';
 import { env } from './env.js';
+import {
+  readDeploymentCapabilities,
+  transactionRequirementMessage,
+  type DeploymentCapabilities,
+} from './mongo-capabilities.js';
 
-export const connectDB = async (): Promise<void> => {
-  await mongoose.connect(env.MONGODB_URI);
+/** Capabilities of the current connection (null before connect / after disconnect). */
+let capabilities: DeploymentCapabilities | null = null;
+let capabilityDatabase: DatabaseHandle | null = null;
+
+export interface ConnectOptions {
+  /**
+   * Fail the connection when the deployment cannot run multi-document
+   * transactions. The API requires them (checkout, cancellation); one-off
+   * maintenance scripts that only touch single documents may opt out.
+   */
+  requireTransactions?: boolean;
+  /** Override the configured URI (tests exercise specific topologies). */
+  uri?: string;
+  /** Test seam: substitute the capability inspector (failure-injection tests). */
+  inspectCapabilities?: (db: DatabaseHandle) => Promise<DeploymentCapabilities>;
+}
+
+type DatabaseHandle = NonNullable<typeof mongoose.connection.db>;
+
+export const connectDB = async ({
+  requireTransactions = true,
+  uri = env.MONGODB_URI,
+  inspectCapabilities = readDeploymentCapabilities,
+}: ConnectOptions = {}): Promise<void> => {
+  // Never let a previous connection's facts leak into this one.
+  capabilities = null;
+  capabilityDatabase = null;
+
+  try {
+    await mongoose.connect(uri);
+  } catch (error) {
+    await mongoose.disconnect().catch(() => undefined);
+    throw error;
+  }
+
+  const db = mongoose.connection.db;
+  if (!db) {
+    await mongoose.disconnect().catch(() => undefined);
+    throw new Error('MongoDB connected but no database handle is available.');
+  }
+
+  let deployment: DeploymentCapabilities;
+  try {
+    deployment = await inspectCapabilities(db);
+  } catch (error) {
+    // Inspection failed: close the connection and fail loudly. Reporting stale
+    // transaction support would let the API start and then 500 on every checkout.
+    await mongoose.disconnect().catch(() => undefined);
+    capabilities = null;
+    throw new Error(
+      'MongoDB connected but its transaction capability could not be verified, so the API will not start. ' +
+        'Check MONGODB_URI and that the deployment allows the `hello` command.',
+      { cause: error },
+    );
+  }
+
+  if (requireTransactions && !deployment.transactions) {
+    // Never run the API in a mode where every checkout would fail at runtime.
+    await mongoose.disconnect().catch(() => undefined);
+    capabilities = null;
+    throw new Error(transactionRequirementMessage(deployment));
+  }
+
+  capabilities = deployment;
+  capabilityDatabase = db;
   const { name } = mongoose.connection;
-  console.log(`MongoDB connected${name ? ` (db: ${name})` : ''}`);
+  console.log(`MongoDB connected${name ? ` (db: ${name})` : ''} — ${deployment.detail}`);
 };
 
+/** Topology facts of the active connection (used by the readiness endpoint). */
+export const getDeploymentCapabilities = (): DeploymentCapabilities | null =>
+  mongoose.connection.readyState === 1 && mongoose.connection.db === capabilityDatabase
+    ? capabilities
+    : null;
+
 export const disconnectDB = async (): Promise<void> => {
+  capabilities = null;
+  capabilityDatabase = null;
   await mongoose.disconnect();
 };
diff --git a/server/src/controllers/admin.controller.ts b/server/src/controllers/admin.controller.ts
index 9156d78..d039285 100644
--- a/server/src/controllers/admin.controller.ts
+++ b/server/src/controllers/admin.controller.ts
@@ -7,6 +7,7 @@ import {
   deleteCategory,
   deleteProduct,
   deleteVariant,
+  restoreVariant,
   getProductAdmin,
   listProducts,
   listVariants,
@@ -87,10 +88,20 @@ export const updateVariantHandler: RequestHandler = async (req, res) => {
 
 export const deleteVariantHandler: RequestHandler = async (req, res) => {
   const { id } = adminIdParamsSchema.parse(req.params);
-  await deleteVariant(id);
+  const result = await deleteVariant(id);
+  if (result.archived) {
+    // Kept for order history: the stock target must survive cancellations.
+    res.status(200).json({ archived: true, orders: result.orderCount });
+    return;
+  }
   res.status(204).end();
 };
 
+export const restoreVariantHandler: RequestHandler = async (req, res) => {
+  const { id } = adminIdParamsSchema.parse(req.params);
+  res.status(200).json({ variant: await restoreVariant(id) });
+};
+
 export const listVariantsHandler: RequestHandler = async (req, res) => {
   const query = adminVariantQuerySchema.parse(req.query);
   res.status(200).json(await listVariants(query));
diff --git a/server/src/controllers/health.controller.ts b/server/src/controllers/health.controller.ts
index fe17885..350e098 100644
--- a/server/src/controllers/health.controller.ts
+++ b/server/src/controllers/health.controller.ts
@@ -1,5 +1,6 @@
 import mongoose from 'mongoose';
 import type { RequestHandler } from 'express';
+import { getDeploymentCapabilities } from '../config/db.js';
 
 /** True only when the default connection is open AND MongoDB answers a ping. */
 const isDatabaseReady = async (): Promise<boolean> => {
@@ -15,7 +16,11 @@ const isDatabaseReady = async (): Promise<boolean> => {
 };
 
 export const getHealth: RequestHandler = async (_req, res) => {
-  const ok = await isDatabaseReady();
-  // Status only — never expose error details.
-  res.status(ok ? 200 : 503).json({ ok });
+  const databaseReady = await isDatabaseReady();
+  // Readiness includes the transaction capability: checkout/cancel cannot work
+  // without it, and the API refuses to start when it is missing.
+  const transactions = databaseReady && (getDeploymentCapabilities()?.transactions ?? false);
+  const ok = databaseReady && transactions;
+  // Status only — never expose error details or connection information.
+  res.status(ok ? 200 : 503).json({ ok, transactions });
 };
diff --git a/server/src/models/cart.model.ts b/server/src/models/cart.model.ts
index e56dd79..1d056a4 100644
--- a/server/src/models/cart.model.ts
+++ b/server/src/models/cart.model.ts
@@ -10,6 +10,11 @@ export interface Cart {
   items: CartItem[];
   /** Timestamp of an active checkout claim; claims older than 60s are stale. */
   checkoutInProgress: Date | null;
+  /**
+   * Optimistic concurrency counter. Every cart mutation and the checkout clear
+   * compare-and-swap on it, so a write can never overwrite a newer state.
+   */
+  version: number;
   createdAt: Date;
   updatedAt: Date;
 }
@@ -31,6 +36,8 @@ const cartSchema = new Schema<Cart>(
     // Guards against concurrent checkout (double submit) for the same cart.
     // A claim older than CHECKOUT_CLAIM_STALE_MS is treated as crashed/stale.
     checkoutInProgress: { type: Date, default: null },
+    // Bumped on every cart write; the checkout clear CASes on it.
+    version: { type: Number, default: 0, min: 0 },
   },
   { timestamps: true },
 );
diff --git a/server/src/models/variant.model.ts b/server/src/models/variant.model.ts
index 4ff3d7e..30f17e7 100644
--- a/server/src/models/variant.model.ts
+++ b/server/src/models/variant.model.ts
@@ -15,6 +15,12 @@ export interface Variant {
   stock: number;
   lowStockThreshold: number;
   images: string[];
+  /**
+   * Set when the variant is retired because orders reference it: the document
+   * (and its stock) is kept so cancellations can restore inventory and order
+   * snapshots keep a valid target. Archived variants are never sold.
+   */
+  archivedAt?: Date | null;
   createdAt: Date;
   updatedAt: Date;
 }
@@ -30,6 +36,7 @@ const variantSchema = new Schema<Variant>(
     stock: { type: Number, required: true, min: 0, default: 0 },
     lowStockThreshold: { type: Number, default: LOW_STOCK_THRESHOLD_DEFAULT, min: 0 },
     images: { type: [String], default: [] },
+    archivedAt: { type: Date, default: null },
   },
   { timestamps: true },
 );
@@ -38,4 +45,5 @@ variantSchema.index({ product: 1 });
 variantSchema.index({ sku: 1 }, { unique: true });
 variantSchema.index({ product: 1, size: 1, color: 1 }, { unique: true });
 
+
 export const VariantModel = model<Variant>('Variant', variantSchema);
diff --git a/server/src/routes/admin.routes.ts b/server/src/routes/admin.routes.ts
index 1f8fcd0..72155fc 100644
--- a/server/src/routes/admin.routes.ts
+++ b/server/src/routes/admin.routes.ts
@@ -18,6 +18,7 @@ import {
   getProductHandler,
   listProductsHandler,
   listVariantsHandler,
+  restoreVariantHandler,
   updateCategoryHandler,
   updateProductHandler,
   updateVariantHandler,
@@ -66,6 +67,7 @@ adminRouter.post(
 );
 adminRouter.get('/variants', listVariantsHandler);
 adminRouter.patch('/variants/:id', validateBody(updateVariantSchema), updateVariantHandler);
+adminRouter.patch('/variants/:id/restore', restoreVariantHandler);
 adminRouter.delete('/variants/:id', deleteVariantHandler);
 
 // Uploads
diff --git a/server/src/scripts/normalize-variants.ts b/server/src/scripts/normalize-variants.ts
index 9fbee4a..47bcf9f 100644
--- a/server/src/scripts/normalize-variants.ts
+++ b/server/src/scripts/normalize-variants.ts
@@ -38,7 +38,7 @@ const main = async (): Promise<void> => {
   console.log(`Target: ${target}`);
   console.log(apply ? 'Mode: APPLY (writes changes)' : 'Mode: dry-run (pass --apply to write)');
 
-  await connectDB();
+  await connectDB({ requireTransactions: false });
 
   const variants = await VariantModel.find().select('product sku size color').exec();
   type VariantDoc = (typeof variants)[number];
diff --git a/server/src/scripts/seed.ts b/server/src/scripts/seed.ts
index d654469..f148dd8 100644
--- a/server/src/scripts/seed.ts
+++ b/server/src/scripts/seed.ts
@@ -89,7 +89,7 @@ const seed = async (): Promise<void> => {
   // `--admin-only` seeds the admin user + category trees and skips the demo
   // products/variants (use this for production databases).
   const adminOnly = process.argv.includes('--admin-only');
-  await connectDB();
+  await connectDB({ requireTransactions: false });
 
   // 1. Admin user (credentials from env — see .env.example)
   const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
diff --git a/server/src/scripts/set-role.ts b/server/src/scripts/set-role.ts
index fb48bbf..1d97d1b 100644
--- a/server/src/scripts/set-role.ts
+++ b/server/src/scripts/set-role.ts
@@ -64,7 +64,7 @@ const main = async (): Promise<void> => {
 
   const { email, role } = args;
 
-  await connectDB();
+  await connectDB({ requireTransactions: false });
   try {
     const user = await UserModel.findOne({ email }).select('email role').exec();
     if (!user) {
diff --git a/server/src/services/admin-catalog.service.ts b/server/src/services/admin-catalog.service.ts
index 3f3c8d8..8a64fba 100644
--- a/server/src/services/admin-catalog.service.ts
+++ b/server/src/services/admin-catalog.service.ts
@@ -1,4 +1,4 @@
-import { Types } from 'mongoose';
+import mongoose, { Types } from 'mongoose';
 import { AppError } from '../middleware/error-handler.js';
 import { COMPARE_AT_RULE_MESSAGE, PRICE_RULE_MESSAGE } from '../utils/pricing.js';
 import { CategoryModel } from '../models/category.model.js';
@@ -61,6 +61,8 @@ export interface VariantAdminDto {
   stock: number;
   lowStockThreshold: number;
   images: string[];
+  /** ISO timestamp when the variant was retired (kept for order history). */
+  archivedAt: string | null;
   inStock: boolean;
   lowStock: boolean;
 }
@@ -110,7 +112,7 @@ const variantStats = async (productIds: Types.ObjectId[]): Promise<Map<string, V
     count: number;
     totalStock: number;
   }>([
-    { $match: { product: { $in: productIds } } },
+    { $match: { product: { $in: productIds }, archivedAt: null } },
     { $group: { _id: '$product', count: { $sum: 1 }, totalStock: { $sum: '$stock' } } },
   ]).exec();
 
@@ -397,7 +399,10 @@ export const updateProduct = async (
 
   // Publishing requires a purchasable product: one variant and one image.
   if (input.status === 'active') {
-    const variantCount = await VariantModel.countDocuments({ product: product._id }).exec();
+    const variantCount = await VariantModel.countDocuments({
+      product: product._id,
+      archivedAt: null,
+    }).exec();
     if (variantCount === 0) {
       throw new AppError(
         400,
@@ -442,29 +447,75 @@ export const updateProduct = async (
 export const deleteProduct = async (
   productId: string,
 ): Promise<{ deleted: boolean; product?: ProductAdminDto; orderCount?: number }> => {
-  const product = await ProductModel.findById(productId).exec();
-  if (!product) {
-    throw new AppError(404, 'NOT_FOUND', 'Product not found');
+  const session = await mongoose.startSession();
+  const result: {
+    deleted?: boolean;
+    orderCount?: number;
+    imagePublicIds?: Array<string | null>;
+  } = {};
+
+  try {
+    await session.withTransaction(async () => {
+      const product = await ProductModel.findById(productId).session(session).exec();
+      if (!product) {
+        throw new AppError(404, 'NOT_FOUND', 'Product not found');
+      }
+
+      // Products referenced by orders are archived: order snapshots keep a valid
+      // product document and its variants (stock targets) stay intact.
+      const orderCount = await OrderModel.countDocuments({ 'items.product': product._id })
+        .session(session)
+        .exec();
+      if (orderCount > 0) {
+        product.status = 'archived';
+        await product.save({ session });
+        result.deleted = false;
+        result.orderCount = orderCount;
+        return;
+      }
+
+      // Remember the assets before the document is gone (Cloudinary cleanup runs
+      // after the commit, best-effort).
+      result.imagePublicIds = normalizeImages(product.images).map((asset) => asset.publicId);
+
+      // Cascade delete inside the same transaction: the variant writes conflict
+      // with a concurrent checkout, so a product that is being bought can never
+      // be deleted underneath it (the retry sees the order and archives instead).
+      await VariantModel.deleteMany({ product: product._id }, { session }).exec();
+      const removed = await ProductModel.deleteOne({ _id: product._id }, { session }).exec();
+      if (removed.deletedCount !== 1) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'Product changed while it was being deleted. Please try again.',
+        );
+      }
+      result.deleted = true;
+      result.orderCount = 0;
+    });
+  } finally {
+    await session.endSession();
   }
 
-  // Prefer archiving over hard delete for products referenced by orders: the
-  // snapshot rows must keep pointing at a product document.
-  const orderCount = await OrderModel.countDocuments({ 'items.product': product._id }).exec();
-  if (orderCount > 0) {
-    product.status = 'archived';
-    await product.save();
+  if (result.deleted === undefined) {
+    throw new AppError(
+      409,
+      'CONFLICT',
+      'Product changed while it was being deleted. Please try again.',
+    );
+  }
+
+  if (!result.deleted) {
+    const archived = await ProductModel.findById(productId).exec();
     return {
       deleted: false,
-      product: toProductDto(product, await statsForProduct(product._id)),
-      orderCount,
+      product: archived ? toProductDto(archived, await statsForProduct(archived._id)) : undefined,
+      orderCount: result.orderCount ?? 0,
     };
   }
 
-  await VariantModel.deleteMany({ product: product._id }).exec();
-  await ProductModel.deleteOne({ _id: product._id }).exec();
-
-  // Hard delete succeeded → best-effort cleanup of the Cloudinary assets.
-  await destroyImageAssets(normalizeImages(product.images).map((asset) => asset.publicId));
+  // Hard delete committed → best-effort cleanup of the Cloudinary assets.
+  await destroyImageAssets(result.imagePublicIds ?? []);
 
   return { deleted: true };
 };
@@ -481,6 +532,7 @@ const toVariantDto = (
     stock: number;
     lowStockThreshold: number;
     images: string[];
+    archivedAt?: Date | null;
   },
   product: { _id: Types.ObjectId; name: string; slug: string },
 ): VariantAdminDto => ({
@@ -494,6 +546,7 @@ const toVariantDto = (
   stock: variant.stock,
   lowStockThreshold: variant.lowStockThreshold,
   images: variant.images,
+  archivedAt: variant.archivedAt ? variant.archivedAt.toISOString() : null,
   inStock: isInStock(variant.stock),
   lowStock: isLowStock(variant.stock, variant.lowStockThreshold),
 });
@@ -750,28 +803,200 @@ export const updateVariant = async (
   return toVariantDto(updated, product);
 };
 
-export const deleteVariant = async (variantId: string): Promise<void> => {
-  const variant = await VariantModel.findById(variantId).exec();
-  if (!variant) {
-    throw new AppError(404, 'NOT_FOUND', 'Variant not found');
+export interface VariantDeleteResult {
+  deleted: boolean;
+  archived: boolean;
+  orderCount: number;
+}
+
+/**
+ * Deletes a variant — or archives it when orders reference it.
+ *
+ * The decision happens inside a transaction that writes to the variant document
+ * first. A checkout decrementing the same variant therefore conflicts with this
+ * transaction, serialising the two: either the checkout commits first (the order
+ * is visible on retry and the variant is archived, keeping its id and stock for
+ * cancellations), or the deletion commits first and the checkout fails its
+ * guarded decrement. Stock can never be restored into a missing document.
+ */
+export const deleteVariant = async (variantId: string): Promise<VariantDeleteResult> => {
+  const session = await mongoose.startSession();
+  const result: { outcome: VariantDeleteResult | null } = { outcome: null };
+
+  try {
+    await session.withTransaction(async () => {
+      const variant = await VariantModel.findById(variantId).session(session).exec();
+      if (!variant) {
+        throw new AppError(404, 'NOT_FOUND', 'Variant not found');
+      }
+
+      // Write first: this is what makes a concurrent checkout conflict with us.
+      const marked = await VariantModel.updateOne(
+        { _id: variant._id },
+        { $set: { archivedAt: variant.archivedAt ?? new Date() } },
+        { session },
+      ).exec();
+      if (marked.matchedCount !== 1) {
+        throw new AppError(404, 'NOT_FOUND', 'Variant not found');
+      }
+
+      const orderCount = await OrderModel.countDocuments({ 'items.variant': variant._id })
+        .session(session)
+        .exec();
+
+      if (orderCount > 0) {
+        // Referenced by history: keep the document (and its stock) even when it is
+        // the product's last variant — the admin's intent is to stop selling it.
+        result.outcome = { deleted: false, archived: true, orderCount };
+        return;
+      }
+
+      // A hard delete must leave at least one purchasable variant behind.
+      const activeSiblings = await VariantModel.countDocuments({
+        product: variant.product,
+        _id: { $ne: variant._id },
+        archivedAt: null,
+      })
+        .session(session)
+        .exec();
+      if (activeSiblings === 0) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'This is the product’s only purchasable variant — add another variant first (a product needs at least one).',
+        );
+      }
+
+      const removed = await VariantModel.deleteOne({ _id: variant._id }, { session }).exec();
+      if (removed.deletedCount !== 1) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'Variant changed while it was being deleted. Please try again.',
+        );
+      }
+
+      result.outcome = { deleted: true, archived: false, orderCount: 0 };
+    });
+  } finally {
+    await session.endSession();
   }
 
-  const siblingCount = await VariantModel.countDocuments({ product: variant.product }).exec();
-  if (siblingCount <= 1) {
+  const outcome = result.outcome;
+  if (!outcome) {
     throw new AppError(
       409,
       'CONFLICT',
-      'This is the product’s only variant — add another variant first (a product needs at least one).',
+      'Variant changed while it was being deleted. Please try again.',
     );
   }
+  return outcome;
+};
 
-  await VariantModel.deleteOne({ _id: variant._id }).exec();
+/**
+ * Restores an archived variant: sets `archivedAt` back to null on the **existing**
+ * document, so its `_id`, SKU, stock and every historical order reference stay
+ * valid. Never creates a replacement document.
+ *
+ * Runs in a transaction that writes the variant, so it serialises with a
+ * concurrent checkout decrement or variant deletion exactly like the archive path.
+ */
+export const restoreVariant = async (variantId: string): Promise<VariantAdminDto> => {
+  const session = await mongoose.startSession();
+  const result: { variant: VariantAdminDto | null } = { variant: null };
+
+  try {
+    await session.withTransaction(async () => {
+      const variant = await VariantModel.findById(variantId).session(session).exec();
+      if (!variant) {
+        throw new AppError(404, 'NOT_FOUND', 'Variant not found');
+      }
+
+      // A variant without its product is not sellable, so it must not be revived.
+      const product = await ProductModel.findById(variant.product).session(session).exec();
+      if (!product) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'The product that owns this variant no longer exists, so the variant cannot be restored.',
+        );
+      }
+
+      if (!variant.archivedAt) {
+        // Idempotent: a double click (or a stale admin list) is not an error.
+        result.variant = toVariantDto(variant, product);
+        return;
+      }
+
+      // Lock the parent against deletion without changing its publication status.
+      // A read alone could let a product disappear after our transaction snapshot.
+      const parent = await ProductModel.updateOne(
+        { _id: product._id },
+        { $inc: { __v: 1 } },
+        { session },
+      ).exec();
+      if (parent.matchedCount !== 1) {
+        throw new AppError(409, 'CONFLICT', 'The parent product changed. Reload and try again.');
+      }
+
+      // Defence in depth: the unique {product,size,color} index should make this
+      // impossible, but a legacy/out-of-band document must never break the index.
+      const conflict = await VariantModel.findOne({
+        _id: { $ne: variant._id },
+        $or: [
+          { sku: variant.sku },
+          { product: variant.product, size: variant.size, color: variant.color },
+        ],
+      })
+        .session(session)
+        .select('sku')
+        .exec();
+      if (conflict) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          `Cannot restore: variant ${conflict.sku} already uses this SKU or size and color.`,
+        );
+      }
+
+      // Restore only the archived state read by this transaction. On a write
+      // conflict MongoDB retries and rechecks the current variant and parent.
+      const restored = await VariantModel.findOneAndUpdate(
+        { _id: variant._id, archivedAt: variant.archivedAt },
+        { $set: { archivedAt: null } },
+        { returnDocument: 'after', session },
+      ).exec();
+      if (!restored) {
+        throw new AppError(
+          409,
+          'CONFLICT',
+          'The variant changed while it was being restored. Reload and try again.',
+        );
+      }
+
+      result.variant = toVariantDto(restored, product);
+    });
+  } catch (error) {
+    if (isDuplicateKeyError(error)) {
+      throw new AppError(409, 'CONFLICT', 'The SKU or size and color already exists. The variant was not restored.');
+    }
+    throw error;
+  } finally {
+    await session.endSession();
+  }
+
+  const restored = result.variant;
+  if (!restored) {
+    throw new AppError(409, 'CONFLICT', 'The variant could not be restored. Please try again.');
+  }
+  return restored;
 };
 
 export const listVariants = async (
   query: AdminVariantQuery,
 ): Promise<AdminListResult<VariantAdminDto>> => {
-  const filter: Record<string, unknown> = {};
+  // Low-stock monitoring only looks at variants that can still be sold.
+  const filter: Record<string, unknown> = { archivedAt: null };
   if (query.lowStock === 'true') {
     filter.$expr = {
       $and: [{ $lte: ['$stock', '$lowStockThreshold'] }, { $gt: ['$stock', 0] }],
diff --git a/server/src/services/admin-order.service.ts b/server/src/services/admin-order.service.ts
index f329f12..3ffadf5 100644
--- a/server/src/services/admin-order.service.ts
+++ b/server/src/services/admin-order.service.ts
@@ -112,11 +112,20 @@ export const adminUpdateOrderStatus = async (
       // Status change + stock restore + flag commit together or not at all.
       if (target === 'cancelled') {
         for (const item of updated.items) {
-          await VariantModel.updateOne(
+          const restored = await VariantModel.updateOne(
             { _id: item.variant },
             { $inc: { stock: item.quantity } },
             { session },
           ).exec();
+          // A missing variant cannot be restocked: abort the transaction rather
+          // than leaving a cancelled order with unrestored inventory.
+          if (restored.matchedCount !== 1) {
+            throw new AppError(
+              409,
+              'STOCK_RESTORE_FAILED',
+              `Cannot restore stock for ${item.sku}: the variant no longer exists. The order was not cancelled.`,
+            );
+          }
         }
       }
 
diff --git a/server/src/services/cart.service.ts b/server/src/services/cart.service.ts
index ba89000..b70ae36 100644
--- a/server/src/services/cart.service.ts
+++ b/server/src/services/cart.service.ts
@@ -1,7 +1,13 @@
 import type { HydratedDocument, Types } from 'mongoose';
+import {
+  CART_MUTATION_ATTEMPTS,
+  CHECKOUT_CLAIM_STALE_MS,
+  CHECKOUT_IN_PROGRESS_MESSAGE,
+  cartVersionFilter,
+} from '../config/checkout.js';
 import { env } from '../config/env.js';
 import { AppError } from '../middleware/error-handler.js';
-import { CartModel, type CartDocument } from '../models/cart.model.js';
+import { CartModel, type CartDocument, type CartItem } from '../models/cart.model.js';
 import { ProductModel, type Product } from '../models/product.model.js';
 import { VariantModel, type Variant } from '../models/variant.model.js';
 import { mergeCartItemSchema, type MergeCartItemInput } from '../schemas/cart.schema.js';
@@ -35,25 +41,105 @@ export interface CartView {
 type VariantDoc = HydratedDocument<Variant>;
 type ProductDoc = HydratedDocument<Product>;
 
+const isDuplicateKeyError = (error: unknown): boolean =>
+  typeof error === 'object' &&
+  error !== null &&
+  'code' in error &&
+  (error as { code?: unknown }).code === 11000;
+
+/** True while another request holds a non-stale checkout claim on the cart. */
+const hasActiveCheckout = (cart: { checkoutInProgress: Date | null }, now: number): boolean =>
+  cart.checkoutInProgress !== null &&
+  now - cart.checkoutInProgress.getTime() < CHECKOUT_CLAIM_STALE_MS;
+
 const getOrCreateCart = async (userId: Types.ObjectId): Promise<CartDocument> => {
-  const cart = await CartModel.findOneAndUpdate(
-    { user: userId },
-    { $setOnInsert: { user: userId, items: [] } },
-    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
-  ).exec();
-
-  if (!cart) {
-    throw new AppError(500, 'SERVER_ERROR', 'Failed to load cart');
+  const existing = await CartModel.findOne({ user: userId }).exec();
+  if (existing) {
+    return existing;
+  }
+
+  try {
+    const created = await CartModel.findOneAndUpdate(
+      { user: userId },
+      { $setOnInsert: { user: userId, items: [], version: 0 } },
+      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
+    ).exec();
+
+    if (!created) {
+      throw new AppError(500, 'SERVER_ERROR', 'Failed to load cart');
+    }
+    return created;
+  } catch (error) {
+    // Two first-time requests can race the unique user index. The loser simply
+    // re-reads the winner's cart — never a 500, never a second cart.
+    if (isDuplicateKeyError(error)) {
+      const raced = await CartModel.findOne({ user: userId }).exec();
+      if (raced) {
+        return raced;
+      }
+    }
+    throw error;
+  }
+};
+
+/**
+ * Applies a cart mutation through a compare-and-swap on `version`, and only
+ * while no checkout claim is active. This is what stops a cart write from being
+ * silently erased by checkout's final clear (or vice versa):
+ *
+ * - mutations are rejected with 409 while checkout holds a non-stale claim;
+ * - a concurrent mutation makes the CAS fail and the operation retries on the
+ *   freshly loaded cart instead of overwriting it;
+ * - checkout itself clears with the same CAS (see order.service).
+ */
+const mutateCart = async (
+  userId: Types.ObjectId,
+  mutate: (items: CartItem[]) => CartItem[],
+): Promise<CartDocument> => {
+  for (let attempt = 1; attempt <= CART_MUTATION_ATTEMPTS; attempt += 1) {
+    const cart = await getOrCreateCart(userId);
+    const now = Date.now();
+
+    if (hasActiveCheckout(cart, now)) {
+      throw new AppError(409, 'CHECKOUT_IN_PROGRESS', CHECKOUT_IN_PROGRESS_MESSAGE);
+    }
+
+    const nextItems = mutate(
+      cart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
+    );
+    const staleCutoff = new Date(now - CHECKOUT_CLAIM_STALE_MS);
+
+    const updated = await CartModel.findOneAndUpdate(
+      {
+        _id: cart._id,
+        $and: [
+          cartVersionFilter(cart.version),
+          { $or: [{ checkoutInProgress: null }, { checkoutInProgress: { $lt: staleCutoff } }] },
+        ],
+      },
+      { $set: { items: nextItems }, $inc: { version: 1 } },
+      { returnDocument: 'after' },
+    ).exec();
+
+    if (updated) {
+      return updated;
+    }
+    // Lost the race (concurrent mutation or a claim appeared) → retry.
   }
-  return cart;
+
+  throw new AppError(
+    409,
+    'CONFLICT',
+    'Your cart changed in another request. Please try again.',
+  );
 };
 
-/** Loads a variant + product, or null when unknown/inactive. */
+/** Loads a variant + product, or null when unknown/inactive/archived. */
 const findAvailableVariant = async (
   variantId: string,
 ): Promise<{ variant: NonNullable<VariantDoc>; product: NonNullable<ProductDoc> } | null> => {
   const variant = await VariantModel.findById(variantId).exec();
-  if (!variant) {
+  if (!variant || variant.archivedAt) {
     return null;
   }
   const product = await ProductModel.findById(variant.product).exec();
@@ -92,7 +178,7 @@ const buildCartView = async (cart: CartDocument): Promise<CartView> => {
     const color = variant?.color ?? null;
     const image = variant?.images[0] ?? firstImageUrl(product?.images) ?? null;
 
-    if (!variant || !product || product.status !== 'active') {
+    if (!variant || !product || product.status !== 'active' || variant.archivedAt) {
       return {
         variantId,
         product: variant ? variant.product.toString() : null,
@@ -154,19 +240,20 @@ export const addItem = async (
     throw new AppError(409, 'CONFLICT', 'Insufficient stock');
   }
 
-  const cart = await getOrCreateCart(userId);
-  const existing = cart.items.find((item) => item.variant.toString() === variantId);
-  const currentQuantity = existing ? existing.quantity : 0;
-  const targetQuantity = Math.min(currentQuantity + quantity, variant.stock);
+  const updated = await mutateCart(userId, (items) => {
+    const existing = items.find((item) => item.variant.toString() === variantId);
+    const currentQuantity = existing ? existing.quantity : 0;
+    // Stock is re-read above; the cap is enforced server-side, never the client.
+    const targetQuantity = Math.min(currentQuantity + quantity, variant.stock);
 
-  if (existing) {
-    existing.quantity = targetQuantity;
-  } else {
-    cart.items.push({ variant: variant._id, quantity: targetQuantity });
-  }
+    if (existing) {
+      existing.quantity = targetQuantity;
+      return items;
+    }
+    return [...items, { variant: variant._id, quantity: targetQuantity }];
+  });
 
-  await cart.save();
-  return buildCartView(cart);
+  return buildCartView(updated);
 };
 
 export const updateItem = async (
@@ -174,12 +261,6 @@ export const updateItem = async (
   variantId: string,
   quantity: number,
 ): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
-  const existing = cart.items.find((item) => item.variant.toString() === variantId);
-  if (!existing) {
-    throw new AppError(404, 'NOT_FOUND', 'Item not in cart');
-  }
-
   const available = await findAvailableVariant(variantId);
   if (!available) {
     throw new AppError(409, 'CONFLICT', 'Item is no longer available');
@@ -189,23 +270,28 @@ export const updateItem = async (
     throw new AppError(409, 'CONFLICT', 'Insufficient stock');
   }
 
-  existing.quantity = Math.min(quantity, variant.stock);
-  await cart.save();
-  return buildCartView(cart);
+  const updated = await mutateCart(userId, (items) => {
+    const existing = items.find((item) => item.variant.toString() === variantId);
+    if (!existing) {
+      throw new AppError(404, 'NOT_FOUND', 'Item not in cart');
+    }
+    existing.quantity = Math.min(quantity, variant.stock);
+    return items;
+  });
+
+  return buildCartView(updated);
 };
 
 export const removeItem = async (userId: Types.ObjectId, variantId: string): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
-  cart.items = cart.items.filter((item) => item.variant.toString() !== variantId);
-  await cart.save();
-  return buildCartView(cart);
+  const updated = await mutateCart(userId, (items) =>
+    items.filter((item) => item.variant.toString() !== variantId),
+  );
+  return buildCartView(updated);
 };
 
 export const clearCart = async (userId: Types.ObjectId): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
-  cart.items = [];
-  await cart.save();
-  return buildCartView(cart);
+  const updated = await mutateCart(userId, () => []);
+  return buildCartView(updated);
 };
 
 /** Merges a guest (localStorage) cart. Invalid entries are skipped, valid ones are capped at stock. */
@@ -213,7 +299,7 @@ export const mergeGuestItems = async (
   userId: Types.ObjectId,
   rawItems: unknown[],
 ): Promise<CartView> => {
-  const cart = await getOrCreateCart(userId);
+  const additions: Array<{ variant: NonNullable<VariantDoc>; quantity: number }> = [];
 
   for (const raw of rawItems) {
     const parsed = mergeCartItemSchema.safeParse(raw);
@@ -226,20 +312,29 @@ export const mergeGuestItems = async (
     if (!available || available.variant.stock === 0) {
       continue;
     }
-    const { variant } = available;
+    additions.push({ variant: available.variant, quantity: entry.quantity });
+  }
 
-    const existing = cart.items.find((item) => item.variant.toString() === entry.variantId);
-    const currentQuantity = existing ? existing.quantity : 0;
-    const targetQuantity = Math.min(currentQuantity + entry.quantity, variant.stock);
+  const updated = await mutateCart(userId, (items) => {
+    for (const addition of additions) {
+      const existing = items.find(
+        (item) => item.variant.toString() === addition.variant._id.toString(),
+      );
+      const currentQuantity = existing ? existing.quantity : 0;
+      const targetQuantity = Math.min(
+        currentQuantity + addition.quantity,
+        addition.variant.stock,
+      );
 
-    if (existing) {
-      existing.quantity = targetQuantity;
-    } else {
-      cart.items.push({ variant: variant._id, quantity: targetQuantity });
+      if (existing) {
+        existing.quantity = targetQuantity;
+      } else {
+        items.push({ variant: addition.variant._id, quantity: targetQuantity });
+      }
     }
-  }
+    return items;
+  });
 
-  await cart.save();
-  return buildCartView(cart);
+  return buildCartView(updated);
 };
 
diff --git a/server/src/services/order.service.ts b/server/src/services/order.service.ts
index 7ca6a95..946be1c 100644
--- a/server/src/services/order.service.ts
+++ b/server/src/services/order.service.ts
@@ -1,4 +1,5 @@
 import mongoose, { type ClientSession, type Types } from 'mongoose';
+import { CHECKOUT_CLAIM_STALE_MS, cartVersionFilter } from '../config/checkout.js';
 import { env } from '../config/env.js';
 import { AppError } from '../middleware/error-handler.js';
 import { CartModel } from '../models/cart.model.js';
@@ -52,9 +53,6 @@ export interface OrderListResult {
 
 const ORDER_NUMBER_ATTEMPTS = 3;
 
-/** A checkout claim older than this is considered stale (crashed request) and can be re-claimed. */
-const CHECKOUT_CLAIM_STALE_MS = 60_000;
-
 const isDuplicateKeyError = (error: unknown): boolean =>
   typeof error === 'object' &&
   error !== null &&
@@ -110,20 +108,34 @@ const resolveShippingAddress = (
   return { fullName, phone, line1, line2, city, state, postalCode, country };
 };
 
+interface CartLineIssue {
+  path: string;
+  message: string;
+}
+
+/**
+ * Rebuilds order lines from the database and rejects anything that is not
+ * genuinely orderable. Runs once before the checkout claim (fast, actionable
+ * feedback) and again inside the transaction (authoritative).
+ *
+ * Checks per line: positive quantity, variant exists and is not archived,
+ * product exists and is active, price is a positive integer in poisha, and the
+ * requested quantity is within stock. All issues are returned together so the
+ * shopper can fix the cart in one pass.
+ */
 const buildOrderItems = async (
   cartItems: Array<{ variant: Types.ObjectId; quantity: number }>,
-  session: ClientSession,
+  session?: ClientSession,
 ): Promise<OrderItem[]> => {
-  const variants = await VariantModel.find({
+  const variantQuery = VariantModel.find({
     _id: { $in: cartItems.map((item) => item.variant) },
-  })
-    .session(session)
-    .exec();
-  const products = await ProductModel.find({
+  });
+  const variants = await (session ? variantQuery.session(session) : variantQuery).exec();
+
+  const productQuery = ProductModel.find({
     _id: { $in: variants.map((variant) => variant.product) },
-  })
-    .session(session)
-    .exec();
+  });
+  const products = await (session ? productQuery.session(session) : productQuery).exec();
 
   const variantById = new Map<string, (typeof variants)[number]>();
   for (const variant of variants) {
@@ -134,20 +146,52 @@ const buildOrderItems = async (
     productById.set(product._id.toString(), product);
   }
 
-  return cartItems.map((cartItem) => {
+  const issues: CartLineIssue[] = [];
+  const items: OrderItem[] = [];
+
+  for (const cartItem of cartItems) {
     const variant = variantById.get(cartItem.variant.toString());
-    const product = variant ? productById.get(variant.product.toString()) : undefined;
-
-    if (!variant || !product || product.status !== 'active') {
-      throw new AppError(
-        409,
-        'CONFLICT',
-        `Item no longer available: ${variant?.sku ?? 'unknown'}`,
-      );
+    const label = variant?.sku ?? 'Unknown item';
+
+    if (!Number.isInteger(cartItem.quantity) || cartItem.quantity < 1) {
+      issues.push({ path: 'items', message: `${label}: quantity is not valid` });
+      continue;
+    }
+    if (!variant) {
+      issues.push({ path: 'items', message: `${label}: this item is no longer available` });
+      continue;
+    }
+    if (variant.archivedAt) {
+      issues.push({ path: 'items', message: `${variant.sku}: this item is no longer sold` });
+      continue;
+    }
+
+    const product = productById.get(variant.product.toString());
+    if (!product || product.status !== 'active') {
+      issues.push({
+        path: 'items',
+        message: `${variant.sku}: this product is not available right now`,
+      });
+      continue;
     }
 
     const unitPrice = variant.price ?? product.basePrice;
-    return {
+    if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
+      issues.push({
+        path: 'items',
+        message: `${variant.sku}: the price is unavailable, so it cannot be ordered`,
+      });
+      continue;
+    }
+    if (variant.stock < cartItem.quantity) {
+      issues.push({
+        path: 'items',
+        message: `${variant.sku}: only ${variant.stock} left in stock`,
+      });
+      continue;
+    }
+
+    items.push({
       product: product._id,
       variant: variant._id,
       name: product.name,
@@ -158,8 +202,19 @@ const buildOrderItems = async (
       unitPrice,
       quantity: cartItem.quantity,
       lineTotal: unitPrice * cartItem.quantity,
-    };
-  });
+    });
+  }
+
+  if (issues.length > 0) {
+    throw new AppError(
+      409,
+      'CART_NOT_ORDERABLE',
+      'Some items in your cart can no longer be ordered. Review the cart and try again.',
+      issues,
+    );
+  }
+
+  return items;
 };
 
 export const createOrder = async (
@@ -185,6 +240,12 @@ export const createOrder = async (
     throw new AppError(409, 'CONFLICT', 'Cart is empty');
   }
 
+  // Fail fast with per-line reasons before claiming the cart; the same checks
+  // run again inside the transaction, where they are authoritative.
+  await buildOrderItems(
+    cart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
+  );
+
   // Double-submit guard: atomically claim checkout for this cart. A claim that
   // is older than CHECKOUT_CLAIM_STALE_MS counts as stale (crashed request).
   const claimTime = new Date();
@@ -198,8 +259,10 @@ export const createOrder = async (
     { returnDocument: 'after' },
   ).exec();
   if (!claimed) {
-    throw new AppError(409, 'CONFLICT', 'Checkout already in progress');
+    throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'Checkout already in progress');
   }
+  // Version the claim was taken on — the final clear compare-and-swaps on it.
+  const claimedVersion = claimed.version;
 
   // Stock decrements, order creation and cart clearing happen in ONE
   // transaction: any failure aborts everything automatically, so no manual
@@ -211,8 +274,17 @@ export const createOrder = async (
     for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt += 1) {
       try {
         await session.withTransaction(async () => {
-          // Re-validate and re-price everything from the database (inside the session).
-          const items = await buildOrderItems([...cart.items], session);
+          // Re-read the cart inside the transaction. The checkout claim blocks
+          // cart writes, and this read is the snapshot the order is built from —
+          // never the copy loaded before the claim.
+          const freshCart = await CartModel.findOne({ _id: cart._id }).session(session).exec();
+          if (!freshCart || freshCart.items.length === 0) {
+            throw new AppError(409, 'CONFLICT', 'Cart is empty');
+          }
+          const items = await buildOrderItems(
+            freshCart.items.map((item) => ({ variant: item.variant, quantity: item.quantity })),
+            session,
+          );
           const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
           const shippingFee = env.SHIPPING_FEE;
           const total = subtotal + shippingFee;
@@ -254,15 +326,24 @@ export const createOrder = async (
             throw new AppError(500, 'SERVER_ERROR', 'Failed to create order');
           }
 
-          // Clear the cart only if we still hold our claim (stale takeovers
-          // must not wipe a cart that already belongs to a newer checkout).
+          // Compare-and-swap the clear: the claim timestamp AND the cart version
+          // captured at claim time must still match, so a cart that changed
+          // underneath this checkout can never be erased by it.
           const cleared = await CartModel.updateOne(
-            { _id: cart._id, checkoutInProgress: claimTime },
-            { $set: { items: [] } },
+            {
+              _id: cart._id,
+              checkoutInProgress: claimTime,
+              ...cartVersionFilter(claimedVersion),
+            },
+            { $set: { items: [], checkoutInProgress: null }, $inc: { version: 1 } },
             { session },
           ).exec();
-          if (cleared.modifiedCount !== 1) {
-            throw new AppError(409, 'CONFLICT', 'Checkout already in progress');
+          if (cleared.matchedCount !== 1) {
+            throw new AppError(
+              409,
+              'CHECKOUT_CONFLICT',
+              'Your cart changed during checkout. Please review it and try again.',
+            );
           }
 
           result.created = order;
@@ -370,13 +451,22 @@ export const cancelOrder = async (user: UserDocument, orderId: string): Promise<
         throw new AppError(409, 'CONFLICT', 'Order cannot be cancelled');
       }
 
-      // Only the winner of the guarded transition above restores stock.
+      // Only the winner of the guarded transition above restores stock. A
+      // missing variant means inventory cannot be made whole, so the whole
+      // cancellation is aborted instead of reporting a false success.
       for (const item of updated.items) {
-        await VariantModel.updateOne(
+        const restored = await VariantModel.updateOne(
           { _id: item.variant },
           { $inc: { stock: item.quantity } },
           { session },
         ).exec();
+        if (restored.matchedCount !== 1) {
+          throw new AppError(
+            409,
+            'STOCK_RESTORE_FAILED',
+            `Cannot restore stock for ${item.sku}: the variant no longer exists. The order was not cancelled.`,
+          );
+        }
       }
 
       result.cancelled = toOrderDto(updated);
diff --git a/server/src/services/product.service.ts b/server/src/services/product.service.ts
index a3a6347..9a25cf2 100644
--- a/server/src/services/product.service.ts
+++ b/server/src/services/product.service.ts
@@ -181,6 +181,19 @@ export const listProducts = async (query: ProductListQuery): Promise<ProductList
         as: 'variantDocs',
       },
     },
+    {
+      // Archived variants are kept for order history only — never priced,
+      // counted or shown on the storefront.
+      $addFields: {
+        variantDocs: {
+          $filter: {
+            input: '$variantDocs',
+            as: 'variant',
+            cond: { $eq: [{ $ifNull: ['$$variant.archivedAt', null] }, null] },
+          },
+        },
+      },
+    },
     {
       $addFields: {
         effectivePrices: {
@@ -369,7 +382,7 @@ export const getProductBySlug = async (slug: string): Promise<ProductDetail> =>
   }
 
   const [variants, category, sizeGuideKey] = await Promise.all([
-    VariantModel.find({ product: product._id }).sort({ size: 1, color: 1 }).exec(),
+    VariantModel.find({ product: product._id, archivedAt: null }).sort({ size: 1, color: 1 }).exec(),
     CategoryModel.findById(product.category).exec(),
     resolveSizeGuideKey(product.category),
   ]);

```

### Final new file: `client/lib/__tests__/site-url.test.ts`

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isLoopbackHostname, resolveSiteUrl } from '../site-url.ts';

const PROD = { nodeEnv: 'production' as const };

describe('A4 — public site URL guard', () => {
  it('accepts an explicit https origin in production', () => {
    const url = resolveSiteUrl({ ...PROD, raw: 'https://abstract-lifestyle.vercel.app' });
    assert.equal(url.origin, 'https://abstract-lifestyle.vercel.app');
  });

  it('rejects a missing value in production', () => {
    assert.throws(() => resolveSiteUrl({ ...PROD }), /NEXT_PUBLIC_SITE_URL is required/);
  });

  it('rejects localhost in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'http://localhost:3000' }),
      /must use https in production/,
    );
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://localhost:3000' }),
      /must not point at a local host/,
    );
  });

  it('rejects loopback IPs in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://127.0.0.1' }),
      /must not point at a local host/,
    );
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'https://[::1]:3000' }),
      /must not point at a local host/,
    );
  });

  it('rejects plain http in production', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'http://abstract-lifestyle.vercel.app' }),
      /must use https in production/,
    );
  });

  it('rejects a relative/non-absolute value everywhere', () => {
    assert.throws(
      () => resolveSiteUrl({ ...PROD, raw: 'abstract-lifestyle.vercel.app' }),
      /must be an absolute URL/,
    );
    assert.throws(
      () => resolveSiteUrl({ nodeEnv: 'development', raw: '/products' }),
      /must be an absolute URL/,
    );
  });

  it('allows localhost in development and defaults to it', () => {
    assert.equal(resolveSiteUrl({ nodeEnv: 'development' }).origin, 'http://localhost:3000');
    assert.equal(
      resolveSiteUrl({ nodeEnv: 'development', raw: 'http://localhost:3000' }).origin,
      'http://localhost:3000',
    );
  });

  it('uses the Vercel preview origin when no explicit value is set', () => {
    const url = resolveSiteUrl({
      nodeEnv: 'production',
      vercelEnv: 'preview',
      vercelUrl: 'abstract-lifestyle-git-branch.vercel.app',
    });
    assert.equal(url.origin, 'https://abstract-lifestyle-git-branch.vercel.app');
  });

  it('accepts an explicit https value on preview deployments', () => {
    const url = resolveSiteUrl({
      nodeEnv: 'production',
      vercelEnv: 'preview',
      raw: 'https://abstract-lifestyle-git-branch.vercel.app',
    });
    assert.equal(url.origin, 'https://abstract-lifestyle-git-branch.vercel.app');
  });

  it('rejects an explicit localhost preview origin', () => {
    assert.throws(
      () =>
        resolveSiteUrl({
          nodeEnv: 'production',
          vercelEnv: 'preview',
          raw: 'http://localhost:3000',
        }),
      /must use https in production/,
    );
    assert.throws(
      () =>
        resolveSiteUrl({
          nodeEnv: 'production',
          vercelEnv: 'preview',
          raw: 'https://localhost:3000',
        }),
      /must not point at a local host/,
    );
  });

  it('rejects an explicit loopback preview origin', () => {
    for (const host of ['127.0.0.1', '127.2.3.4', '[::1]', '[::ffff:127.0.0.1]', 'app.localhost', 'localhost.']) {
      assert.throws(
        () => resolveSiteUrl({ ...PROD, vercelEnv: 'preview', raw: `https://${host}` }),
        /must not point at a local host/,
      );
    }
  });

  it('rejects explicit non-HTTPS origins in previews even with a valid fallback', () => {
    for (const raw of ['http://example.vercel.app', 'ftp://example.vercel.app']) {
      assert.throws(
        () => resolveSiteUrl({ ...PROD, vercelEnv: 'preview', vercelUrl: 'valid.vercel.app', raw }),
        /must use https/,
      );
    }
  });

  it('rejects unsafe or missing inferred preview origins', () => {
    for (const vercelUrl of ['', 'localhost', '127.1.2.3', '[::1]', 'http://example.vercel.app']) {
      assert.throws(() => resolveSiteUrl({ ...PROD, vercelEnv: 'preview', vercelUrl }), /is required/);
    }
  });

  it('keeps canonical production configuration mandatory despite VERCEL_URL', () => {
    assert.throws(() => resolveSiteUrl({ ...PROD, vercelEnv: 'production', vercelUrl: 'branch.vercel.app' }), /is required/);
  });

  it('fails a preview with no explicit value and no VERCEL_URL', () => {
    assert.throws(
      () =>
        resolveSiteUrl({
          nodeEnv: 'production',
          vercelEnv: 'preview',
        }),
      /is required in production/,
    );
  });

  it('classifies loopback hosts', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '0.0.0.0', '::1', 'app.localhost']) {
      assert.equal(isLoopbackHostname(host), true, host);
    }
    for (const host of ['abstract-lifestyle.vercel.app', 'example.com', '10.0.0.5']) {
      assert.equal(isLoopbackHostname(host), false, host);
    }
  });
});

describe('A4 — consumers use the guarded origin', () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), 'utf8');

  it('seo.ts resolves SITE_URL through resolveSiteUrl and derives absoluteUrl from it', () => {
    const source = read('../seo.ts');
    assert.match(source, /resolveSiteUrl\(/);
    assert.match(source, /export const SITE_URL/);
    assert.match(source, /export const absoluteUrl/);
    assert.doesNotMatch(source, /'http:\/\/localhost:3000'/);
  });

  it('canonical/OG metadata, robots and sitemap all import from lib/seo', () => {
    for (const file of ['../../app/layout.tsx', '../../app/sitemap.ts', '../../app/robots.ts']) {
      const source = read(file);
      assert.match(source, /@\/lib\/seo/, `${file} must use the guarded SEO helpers`);
    }
  });

  it('builds absolute canonical/robots/sitemap URLs from the resolved origin', () => {
    const origin = resolveSiteUrl({ ...PROD, raw: 'https://abstract-lifestyle.vercel.app' });
    assert.equal(new URL('/sitemap.xml', origin).toString(), 'https://abstract-lifestyle.vercel.app/sitemap.xml');
    assert.equal(new URL('/products/mens-pant', origin).toString(), 'https://abstract-lifestyle.vercel.app/products/mens-pant');
  });
});

```

### Final new file: `client/lib/site-url.ts`

```ts
/**
 * Public-origin resolution for metadata, canonicals, OpenGraph, robots and the
 * sitemap. Pure on purpose (no framework imports) so it is unit-testable and can
 * run both at build time and at runtime.
 *
 * Production builds must provide an explicit absolute **https** URL that is not a
 * loopback host. Silently falling back to `http://localhost:3000` would publish
 * localhost canonicals to search engines — the exact failure this guard exists
 * to prevent. Development keeps the convenient localhost default.
 */

export interface SiteUrlInputs {
  /** NEXT_PUBLIC_SITE_URL as provided by the environment. */
  raw?: string | undefined;
  /** NODE_ENV. */
  nodeEnv?: string | undefined;
  /** VERCEL_ENV ("production" | "preview" | "development") when on Vercel. */
  vercelEnv?: string | undefined;
  /** VERCEL_URL (hostname only, no protocol) when on Vercel. */
  vercelUrl?: string | undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') ||
    host.startsWith('127.') || /^::ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(host);
};

const parseAbsoluteUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const REQUIREMENT =
  'Set NEXT_PUBLIC_SITE_URL to the public origin (for example https://abstract-lifestyle.vercel.app) before building for production.';

/**
 * Resolves the public origin or throws with an actionable message.
 *
 * - any production build (`NODE_ENV=production`, which includes Vercel Preview):
 *   an explicit value must be absolute **https** and must not be a loopback host;
 * - Vercel preview with no explicit value: falls back to `https://$VERCEL_URL`,
 *   and fails if that is unavailable (never localhost);
 * - development/test (`NODE_ENV!==production`): localhost default is allowed.
 */
export const resolveSiteUrl = (inputs: SiteUrlInputs): URL => {
  const raw = (inputs.raw ?? '').trim();
  const vercelEnv = (inputs.vercelEnv ?? '').trim();
  const isPreview = vercelEnv === 'preview';
  const strict = inputs.nodeEnv === 'production' || isPreview;

  if (raw.length > 0) {
    const parsed = parseAbsoluteUrl(raw);
    if (!parsed) {
      throw new Error(
        `NEXT_PUBLIC_SITE_URL must be an absolute URL (received "${raw}"). ${REQUIREMENT}`,
      );
    }
    if (strict) {
      if (parsed.protocol !== 'https:') {
        throw new Error(
          `NEXT_PUBLIC_SITE_URL must use https in production (received "${parsed.protocol}//"). ${REQUIREMENT}`,
        );
      }
      if (isLoopbackHostname(parsed.hostname)) {
        throw new Error(
          `NEXT_PUBLIC_SITE_URL must not point at a local host in production (received "${parsed.hostname}"). ${REQUIREMENT}`,
        );
      }
    }
    return parsed;
  }

  // No explicit value: a preview deployment uses its own https origin.
  if (isPreview) {
    const vercelUrl = (inputs.vercelUrl ?? '').trim();
    if (vercelUrl.length > 0) {
      const withProtocol = /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
      const parsed = parseAbsoluteUrl(withProtocol);
      if (parsed && parsed.protocol === 'https:' && !isLoopbackHostname(parsed.hostname)) {
        return parsed;
      }
    }
  }

  if (strict) {
    throw new Error(`NEXT_PUBLIC_SITE_URL is required in production. ${REQUIREMENT}`);
  }

  return new URL('http://localhost:3000');
};

```

### Final new file: `server/src/config/checkout.ts`

```ts
/**
 * Checkout claim lease. A cart marked `checkoutInProgress` older than this is
 * treated as a crashed checkout and may be re-claimed / mutated again.
 *
 * Shared by the cart service (rejects mutations during an active checkout) and
 * the order service (claims / releases the cart) so both sides always agree.
 */
export const CHECKOUT_CLAIM_STALE_MS = 60_000;

/** Maximum attempts for an optimistic cart mutation before giving up. */
export const CART_MUTATION_ATTEMPTS = 3;

export const CHECKOUT_IN_PROGRESS_MESSAGE =
  'Checkout is in progress for this cart. Finish or cancel it, then try again.';

/**
 * Compare-and-swap filter for the cart `version`.
 *
 * Carts created before the version field existed have no stored value; Mongoose
 * hydrates the default `0`, but the document itself has no such field until its
 * first write. Treating "missing" as version 0 keeps those carts mutable
 * instead of failing every compare-and-swap.
 */
export const cartVersionFilter = (version: number): Record<string, unknown> =>
  version === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version };

```

### Final new file: `server/src/config/mongo-capabilities.ts`

```ts
import type { Db } from 'mongodb';

/**
 * What the connected MongoDB deployment can actually do.
 *
 * Order creation and cancellation rely on multi-document transactions, which
 * require a replica set or a sharded cluster — a standalone `mongod` silently
 * accepts the connection but fails every transaction at runtime. The API
 * refuses to start in that case instead of returning 500s to shoppers.
 */
export interface DeploymentCapabilities {
  /** True only when multi-document transactions are supported. */
  transactions: boolean;
  kind: 'replica-set' | 'sharded' | 'standalone' | 'unknown';
  /** Human-readable detail for diagnostics (never contains credentials). */
  detail: string;
}

/** Minimal shape of the `hello` command response we rely on. */
export interface HelloResult {
  setName?: unknown;
  msg?: unknown;
  logicalSessionTimeoutMinutes?: unknown;
  isWritablePrimary?: unknown;
}

/**
 * Pure classification of a `hello` payload. Kept separate from the driver call
 * so it can be unit-tested without a database.
 */
export const classifyDeployment = (hello: HelloResult): DeploymentCapabilities => {
  const isSharded = hello.msg === 'isdbgrid';
  const isReplicaSet = typeof hello.setName === 'string' && hello.setName.length > 0;
  const supportsSessions = typeof hello.logicalSessionTimeoutMinutes === 'number';

  if (isSharded) {
    return {
      transactions: true,
      kind: 'sharded',
      detail: 'sharded cluster (mongos) supports multi-document transactions',
    };
  }

  if (isReplicaSet) {
    return {
      transactions: supportsSessions,
      kind: 'replica-set',
      detail: supportsSessions
        ? `replica set "${hello.setName}" with session support`
        : `replica set "${hello.setName}" without logical session support (transactions unavailable)`,
    };
  }

  return {
    transactions: false,
    kind: supportsSessions ? 'unknown' : 'standalone',
    detail:
      'standalone/unknown deployment without a replica set — multi-document transactions are not supported',
  };
};

/** Read-only topology inspection (`hello`). Never writes and never logs the URI. */
export const readDeploymentCapabilities = async (db: Db): Promise<DeploymentCapabilities> => {
  const hello = (await db.admin().command({ hello: 1 })) as HelloResult;
  return classifyDeployment(hello);
};

/**
 * Diagnostic shown when the deployment cannot support order transactions.
 * Includes the executable local fix so the failure is self-service.
 */
export const transactionRequirementMessage = (capabilities: DeploymentCapabilities): string =>
  [
    'This MongoDB deployment cannot run order transactions, which checkout and cancellation require.',
    `Detected: ${capabilities.detail}.`,
    'Run a replica set instead of a standalone mongod. Local single-node example:',
    '  mongod --replSet rs0 --dbpath /path/to/data --port 27017',
    '  mongosh --eval "rs.initiate({_id: \\"rs0\\", members: [{_id: 0, host: \\"127.0.0.1:27017\\"}]})"',
    'Then set MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0 and restart.',
    'Managed MongoDB (Atlas) already runs a replica set — check Network Access/credentials if this appears there.',
  ].join('\n');

```

### Final new file: `server/test/README.md`

```text
# Server tests (Phase 0)

`node:test` + `tsx` (already a dev dependency — nothing new to install).

## Run

```bash
# Unit tests only (no database needed)
npm run test:unit

# Integration + concurrency tests (requires a DISPOSABLE replica set)
MONGODB_TEST_MODE=disposable MONGODB_TEST_URI="mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true" npm run test:db

# Everything
# Set both test variables above first.
npm test
```

PowerShell:

```powershell
$env:MONGODB_TEST_MODE = 'disposable'
$env:MONGODB_TEST_URI = 'mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true'
npm run test:db
```

Without intentional `MONGODB_TEST_MODE=disposable` and `MONGODB_TEST_URI`, the
integration suite **fails before connecting or deleting anything**. `test:unit`
needs no database and includes the negative safety and connection-failure tests.

## Requirements

- MongoDB **replica set** (transactions are mandatory). The suite asserts the
  capability in `before()` and fails with the detected topology otherwise.
- A database that may be **wiped**: `beforeEach` deletes every document in every
  collection it touches.
- The database name must end in `_test`; production/staging/live names, system
  databases and all remote hosts are refused, regardless of other flags.
- The helper checks both the designated URI and the actual driver-resolved
  database/host, binds resets to the approved Db object, and rechecks immediately
  before every deletion. `MONGODB_URI` is never a fallback. No URI or credentials
  are logged. Negative tests use in-memory doubles, never a real unsafe target.
- Use a separate disposable port/database; dbpaths belong outside the repository:

```bash
mongod --replSet rs0 --port 27018 --dbpath /temporary/path/p0-rs
mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"
```

## What is covered

| Area | File |
|---|---|
| A1 — deployment capability classification (pure) | `mongo-capabilities.test.ts` |
| A1 — startup guard: standalone rejected, replica set accepted | `topology-guard.test.ts` |
| R2 — configuration/target refusal, zero deletions, no credential disclosure | `test-database-guard.test.ts` |
| R3 — connection/inspection failure cleanup and health readiness | `db-connect.test.ts` |
| A1/B1 — cart version compare-and-swap filter (pure) | `checkout-version-filter.test.ts` |
| A5 — variant archive/delete, stock restore, cancellation abort, races | `order-integrity.test.ts` |
| B1 — cart mutations vs. checkout claim, concurrent add, replay, rollback/recovery | `order-integrity.test.ts` |
| B2 — first-cart upsert race, per-user isolation, duplicate-key policy | `order-integrity.test.ts` |
| B3 — archived/unpublished/out-of-stock/priceless/invalid-quantity lines, valid COD order | `order-integrity.test.ts` |
| R1/R4 — restore identity/history/races/auth, both cancellation paths, HTTP checkout 409s | `order-integrity.test.ts` |

`MONGODB_STANDALONE_URI` is optional; when set, the A1 guard test proves that a plain `mongod`
(no `--replSet`) is refused at startup. Start one alongside the replica set:

```bash
mongod --port 27019 --dbpath /temporary/path/p0-sa
```

Set `MONGODB_STANDALONE_URI=mongodb://127.0.0.1:27019/p0_standalone_test`.
This optional read-only topology check also requires the safe local `_test`
target and disposable mode. Stop the local processes and remove their temporary
dbpaths after verification.

Client-side A4 tests run with the built-in Node test runner (no dependencies):
`cd client && npm test`.


```

### Final new file: `server/test/checkout-version-filter.test.ts`

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cartVersionFilter } from '../src/config/checkout.js';

describe('B1 — cart version compare-and-swap filter', () => {
  it('accepts legacy carts that have no stored version when expecting 0', () => {
    assert.deepEqual(cartVersionFilter(0), {
      $or: [{ version: 0 }, { version: { $exists: false } }],
    });
  });

  it('matches the exact version for a cart that already has one', () => {
    assert.deepEqual(cartVersionFilter(3), { version: 3 });
  });
});

```

### Final new file: `server/test/db-connect.test.ts`

```ts
import './setup-env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import express from 'express';
import { once } from 'node:events';
import { connectDB, disconnectDB, getDeploymentCapabilities } from '../src/config/db.js';
import type { DeploymentCapabilities } from '../src/config/mongo-capabilities.js';
import { getHealth } from '../src/controllers/health.controller.js';
import { mockConnection } from './helpers/mock-connection.js';

const uri = 'mongodb://127.0.0.1:1/unavailable_test'; // never opened by these unit tests
const db = { admin: () => ({ command: async () => ({ setName: 'rs0', logicalSessionTimeoutMinutes: 30, ok: 1 }) }) };

const noTransactions: DeploymentCapabilities = {
  transactions: false,
  kind: 'standalone',
  detail: 'standalone deployment',
};

describe('R3/P2 — MongoDB capability inspection failure handling', () => {
  it('closes the connection and clears previous capabilities when inspection throws', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    assert.equal(getDeploymentCapabilities()?.transactions, true);
    const throwingInspector = async (): Promise<DeploymentCapabilities> => {
      throw new Error('hello command not allowed');
    };

    await assert.rejects(
      connectDB({
        uri,
        inspectCapabilities: throwingInspector,
      }),
      /transaction capability could not be verified/,
    );

    assert.equal(mongoose.connection.readyState, 0, 'connection closed after inspection failure');
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('does not start when the deployment lacks transactions', async (t) => {
    mockConnection(t, db);
    const noTxInspector = async (): Promise<DeploymentCapabilities> => noTransactions;

    await assert.rejects(
      connectDB({
        uri,
        inspectCapabilities: noTxInspector,
      }),
      /cannot run order transactions/,
    );

    assert.equal(
      mongoose.connection.readyState,
      0,
      'connection closed for non-transactional deployment',
    );
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('connects successfully when inspection succeeds on a replica set', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });

    const caps = getDeploymentCapabilities();
    assert.ok(caps);
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'replica-set');

    await disconnectDB();
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('cleans up and clears previous capabilities when connecting fails', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    const failure = new Error('injected connection failure');
    t.mock.method(mongoose, 'connect', async () => { throw failure; });
    await assert.rejects(connectDB({ uri }), (error: unknown) => error === failure);
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('clears capabilities even if disconnect itself fails', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    t.mock.method(mongoose, 'disconnect', async () => { throw new Error('disconnect failure'); });
    await assert.rejects(disconnectDB(), /disconnect failure/);
    assert.equal(getDeploymentCapabilities(), null);
  });

  it('never returns stale support after connection loss or replacement', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true, writable: true });
    assert.equal(getDeploymentCapabilities(), null);
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true, writable: true });
    Object.defineProperty(mongoose.connection, 'db', { value: { ...db }, configurable: true, writable: true });
    assert.equal(getDeploymentCapabilities(), null);
    await disconnectDB();
  });

  it('returns HTTP 503 without stale transaction support after inspection fails', async (t) => {
    mockConnection(t, db);
    await connectDB({ uri });
    await assert.rejects(connectDB({ uri, inspectCapabilities: async () => { throw new Error('hello failure'); } }));
    const app = express();
    app.get('/health', getHealth);
    const server = app.listen(0, '127.0.0.1');
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, transactions: false });
  });
});

```

### Final new file: `server/test/guards/test-database.ts`

```ts
/**
 * Fail-closed guard for the *destructive* integration-test harness.
 *
 * The suite deletes every document in every collection of the database it is
 * pointed at. A mis-set `MONGODB_TEST_URI` (a copy/pasted Atlas URI, a CI secret
 * aimed at staging) must therefore fail **before** any delete rather than wipe
 * real data.
 *
 * Rules (all must hold):
 * 1. an explicit test URI must be configured — the application URI is never used;
 * 2. the *resolved* database name (reported by the driver, not parsed from the
 *    URI string) must end with `_test`;
 * 3. the resolved name must not look production-like (`prod`, `staging`, `live`)
 *    and must not be a known system/application database;
 * 4. only loopback deployments are permitted; remote opt-ins cannot bypass this;
 * 5. MONGODB_TEST_MODE must explicitly be `disposable`.
 *
 * Nothing here ever logs a URI or credentials — only the database name.
 */

export const TEST_DATABASE_SUFFIX = '_test';

/** Exact database names that must never be wiped. */
const FORBIDDEN_EXACT = new Set([
  'abstract_lifestyle',
  'admin',
  'config',
  'local',
  'test',
]);

/** Substrings that mark a production/staging database. */
const FORBIDDEN_SUBSTRINGS = ['prod', 'staging', 'stage', 'live'];

export interface TestTargetInput {
  /** Database name as resolved by the driver (`db.databaseName`). */
  databaseName: string;
  /** Host reported by the driver, e.g. `127.0.0.1` or `acme.abc.mongodb.net`. */
  host: string;
}

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTestDatabaseError';
  }
}

const isLoopbackHost = (host: string): boolean => {
  const normalised = host.trim().toLowerCase();
  return (
    normalised === 'localhost' ||
    normalised === '127.0.0.1' ||
    normalised === '::1' ||
    normalised === '[::1]'
  );
};

/**
 * Pure validation — used before connecting (best effort) and again with the
 * resolved target after connecting (authoritative).
 */
export const assertSafeTestTarget = (input: TestTargetInput): void => {
  const name = input.databaseName.trim();
  const host = input.host.trim();

  if (name.length === 0) {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: the test database name is empty. No records were deleted.',
    );
  }
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run: the test database must be named "*${TEST_DATABASE_SUFFIX}" (resolved "${name}"). No records were deleted.`,
    );
  }

  const lower = name.toLowerCase();
  if (FORBIDDEN_EXACT.has(lower)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run against the "${name}" database: it is a reserved/application database. No records were deleted.`,
    );
  }
  const forbidden = FORBIDDEN_SUBSTRINGS.find((part) => lower.includes(part));
  if (forbidden) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run against "${name}": it looks like a production/staging database ("${forbidden}"). No records were deleted.`,
    );
  }
  if (!isLoopbackHost(host)) {
    throw new UnsafeTestDatabaseError(
      'Refusing to run against a remote host: only disposable loopback deployments are permitted. No records were deleted.',
    );
  }
};

/**
 * Best-effort pre-connection check derived from the URI string. The authoritative
 * check always runs again against the driver-reported database name.
 */
export const assertSafeTestUri = (uri: string): TestTargetInput => {
  if (uri.trim().length === 0) {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: MONGODB_TEST_URI is not set, so no test database is designated. No records were deleted.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: MONGODB_TEST_URI is not a valid URI. No records were deleted.',
    );
  }
  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: MONGODB_TEST_URI must use the mongodb:// or mongodb+srv:// scheme. No records were deleted.',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new UnsafeTestDatabaseError('Refusing invalid test database encoding. No records were deleted.');
  }
  const host = parsed.hostname;
  assertSafeTestTarget({ databaseName, host });
  return { databaseName, host };
};

export const requireTestDatabaseConfig = (
  configuration: NodeJS.ProcessEnv = process.env,
): { uri: string; target: TestTargetInput } => {
  if (configuration.MONGODB_TEST_MODE !== 'disposable') {
    throw new UnsafeTestDatabaseError(
      'Refusing to run: set MONGODB_TEST_MODE=disposable intentionally. No records were deleted.',
    );
  }
  const uri = (configuration.MONGODB_TEST_URI ?? '').trim();
  return { uri, target: assertSafeTestUri(uri) };
};

```

### Final new file: `server/test/helpers/mock-connection.ts`

```ts
import type { TestContext } from 'node:test';
import mongoose from 'mongoose';

/** Unit tests substitute a connection without ever opening a socket. */
export const mockConnection = (
  context: TestContext,
  db: unknown,
  host = '127.0.0.1',
) => {
  for (const [key, value] of Object.entries({ db, host, readyState: 1 })) {
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, key);
    Object.defineProperty(mongoose.connection, key, { value, configurable: true, writable: true });
    context.after(() => {
      if (descriptor) Object.defineProperty(mongoose.connection, key, descriptor);
      else Reflect.deleteProperty(mongoose.connection, key);
    });
  }
  const connect = context.mock.method(mongoose, 'connect', async () => mongoose);
  context.mock.method(mongoose, 'disconnect', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true, writable: true });
  });
  return connect;
};

```

### Final new file: `server/test/helpers/test-db.ts`

```ts
import mongoose from 'mongoose';
import {
  assertSafeTestTarget,
  requireTestDatabaseConfig,
  UnsafeTestDatabaseError,
} from '../guards/test-database.js';

let approvedDatabase: typeof mongoose.connection.db | null = null;

/** The target the driver actually resolved — the authoritative check input. */
export const resolveTestTarget = (): { databaseName: string; host: string } => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Not connected to a MongoDB test database.');
  }
  return { databaseName: db.databaseName, host: mongoose.connection.host ?? '' };
};

/**
 * Connects to the designated test database and refuses to continue unless the
 * driver-resolved target is safe (suffix `_test`, not production-like, loopback
 * only). On refusal the connection is closed again.
 */
export const connectTestDatabase = async (): Promise<void> => {
  approvedDatabase = null;
  const { uri, target } = requireTestDatabaseConfig();
  try {
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
    assertSafeTestTarget(resolveTestTarget()); // authoritative, driver-resolved
    if (mongoose.connection.db?.databaseName !== target.databaseName) {
      throw new UnsafeTestDatabaseError('Resolved database differs from the designated test database. No records were deleted.');
    }
    approvedDatabase = mongoose.connection.db;
  } catch {
    await mongoose.disconnect().catch(() => undefined);
    throw new UnsafeTestDatabaseError('Test connection failed or resolved to an unsafe target. No records were deleted.');
  }
};

/**
 * Deletes every document in every collection — guarded before each call.
 *
 * Revalidate both configuration and the actual Db object before every deletion.
 * No database-name override or remote opt-in can bypass these checks.
 */
export const resetTestDatabase = async (): Promise<void> => {
  const db = mongoose.connection.db;
  const validate = (): void => {
    const { target } = requireTestDatabaseConfig();
    const resolved = resolveTestTarget();
    assertSafeTestTarget(resolved);
    if (!db || db !== approvedDatabase || db !== mongoose.connection.db ||
        db.databaseName !== target.databaseName || mongoose.connection.readyState !== 1) {
      throw new UnsafeTestDatabaseError('Connection is not the approved disposable test database. No records were deleted.');
    }
  };
  validate();
  if (!db) throw new UnsafeTestDatabaseError('No approved database. No records were deleted.');
  const collections = await db.collections();
  for (const collection of collections) {
    validate();
    await collection.deleteMany({});
  }
};

export const disconnectTestDatabase = async (): Promise<void> => {
  approvedDatabase = null;
  await mongoose.disconnect();
};

export { UnsafeTestDatabaseError };

```

### Final new file: `server/test/mongo-capabilities.test.ts`

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDeployment,
  transactionRequirementMessage,
  type HelloResult,
} from '../src/config/mongo-capabilities.js';

describe('A1 — deployment capability classification', () => {
  it('accepts a replica set with logical sessions', () => {
    const hello: HelloResult = { setName: 'atlas-abc', logicalSessionTimeoutMinutes: 30 };
    const caps = classifyDeployment(hello);
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'replica-set');
    assert.match(caps.detail, /replica set "atlas-abc"/);
  });

  it('rejects a replica set without logical sessions', () => {
    const caps = classifyDeployment({ setName: 'rs0' });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'replica-set');
  });

  it('accepts a sharded cluster (mongos)', () => {
    const caps = classifyDeployment({ msg: 'isdbgrid', logicalSessionTimeoutMinutes: 30 });
    assert.equal(caps.transactions, true);
    assert.equal(caps.kind, 'sharded');
  });

  it('rejects a standalone server', () => {
    const caps = classifyDeployment({ isWritablePrimary: true });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'standalone');
  });

  it('treats a session-capable but unnamed topology as unknown, not transactional', () => {
    const caps = classifyDeployment({ logicalSessionTimeoutMinutes: 30 });
    assert.equal(caps.transactions, false);
    assert.equal(caps.kind, 'unknown');
  });

  it('explains how to run a local replica set', () => {
    const message = transactionRequirementMessage(classifyDeployment({}));
    assert.match(message, /--replSet rs0/);
    assert.match(message, /rs\.initiate/);
    assert.match(message, /MONGODB_URI/);
  });
});

```

### Final new file: `server/test/order-integrity.test.ts`

```ts
import './setup-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { readDeploymentCapabilities } from '../src/config/mongo-capabilities.js';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from './helpers/test-db.js';
import { CartModel } from '../src/models/cart.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { UserModel, type UserDocument } from '../src/models/user.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { createVariant, deleteProduct, deleteVariant, restoreVariant } from '../src/services/admin-catalog.service.js';
import { adminUpdateOrderStatus } from '../src/services/admin-order.service.js';
import { createApp } from '../src/app.js';
import { signAuthToken } from '../src/utils/jwt.js';
import { addItem, clearCart, getCart, mergeGuestItems, removeItem, updateItem } from '../src/services/cart.service.js';
import { cancelOrder, createOrder } from '../src/services/order.service.js';
import { AppError } from '../src/middleware/error-handler.js';
import { CHECKOUT_CLAIM_STALE_MS } from '../src/config/checkout.js';

let sequence = 0;
const unique = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

interface Fixture {
  user: UserDocument;
  product: Types.ObjectId;
  variant: Types.ObjectId;
  sku: string;
}

const makeFixture = async (
  options: { stock?: number; price?: number | null; basePrice?: number } = {},
): Promise<Fixture> => {
  const tag = unique('p0');
  const user = await UserModel.create({
    email: `${tag}@example.com`,
    name: 'P0 Test User',
    role: 'customer',
  });
  const category = await CategoryModel.create({ name: `Cat ${tag}`, slug: `cat-${tag}` });
  const product = await ProductModel.create({
    name: `Product ${tag}`,
    slug: `product-${tag}`,
    description: 'Fixture product for Phase 0 regression tests.',
    category: category._id,
    basePrice: options.basePrice ?? 10000,
    images: [],
    status: 'active',
  });
  const sku = `SKU-${tag}`;
  const variant = await VariantModel.create({
    product: product._id,
    sku,
    size: 'M',
    color: null,
    price: options.price === undefined ? null : options.price,
    stock: options.stock ?? 10,
    lowStockThreshold: 5,
    images: [],
  });

  return { user, product: product._id, variant: variant._id, sku: variant.sku };
};

const addSecondVariant = async (fixture: Fixture, stock = 5): Promise<Types.ObjectId> => {
  const variant = await VariantModel.create({
    product: fixture.product,
    sku: `SKU2-${unique('v')}`,
    size: 'L',
    color: null,
    price: null,
    stock,
    lowStockThreshold: 5,
    images: [],
  });
  return variant._id;
};

const placeOrder = async (user: UserDocument, checkoutId = randomUUID()) =>
  createOrder(user, {
    checkoutId,
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'P0 Test User',
      phone: '01700000000',
      line1: 'House 1, Road 1',
      isDefault: true,
    },
  });

const stockOf = async (variantId: Types.ObjectId): Promise<number | null> => {
  const variant = await VariantModel.findById(variantId).select('stock').lean().exec();
  return variant ? variant.stock : null;
};

describe('Phase 0 — order integrity (A5, B1, B2, B3)', () => {
  let server: Server | undefined;
  let origin: string;
  before(async () => {
    // Fail-closed: refuses unless the *resolved* database is a designated *_test DB.
    await connectTestDatabase();

    // A1: the suite refuses to run on a deployment without transactions.
    const db = mongoose.connection.db;
    assert.ok(db, 'connected database handle is available');
    const capabilities = await readDeploymentCapabilities(db);
    assert.equal(
      capabilities.transactions,
      true,
      `test database must be a replica set (${capabilities.detail})`,
    );

    await Promise.all([
      UserModel.syncIndexes(),
      CategoryModel.syncIndexes(),
      ProductModel.syncIndexes(),
      VariantModel.syncIndexes(),
      CartModel.syncIndexes(),
      OrderModel.syncIndexes(),
    ]);
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    }
    await disconnectTestDatabase();
  });

  // ---- A5 -----------------------------------------------------------------
  describe('A5 — variant deletion vs. order history', () => {
    it('archives a variant referenced by an order and restores its stock on cancel', async () => {
      const fixture = await makeFixture({ stock: 10 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      assert.equal(await stockOf(fixture.variant), 8);

      const result = await deleteVariant(fixture.variant.toString());
      assert.deepEqual(result, { deleted: false, archived: true, orderCount: 1 });

      const archived = await VariantModel.findById(fixture.variant).lean().exec();
      assert.ok(archived, 'variant document is retained');
      assert.ok(archived.archivedAt instanceof Date);
      assert.equal(archived.stock, 8);

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 10, 'stock restored into the archived variant');
    });

    it('hard-deletes a variant that no order references', async () => {
      const fixture = await makeFixture({ stock: 4 });
      const second = await addSecondVariant(fixture, 3);

      const result = await deleteVariant(second.toString());
      assert.deepEqual(result, { deleted: true, archived: false, orderCount: 0 });
      assert.equal(await VariantModel.findById(second).lean().exec(), null);
    });

    it('refuses to retire the last purchasable variant', async () => {
      const fixture = await makeFixture({ stock: 4 });
      await assert.rejects(deleteVariant(fixture.variant.toString()), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /only purchasable variant/);
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 4);
    });

    it('aborts the cancellation when the variant no longer exists (no false success)', async () => {
      const fixture = await makeFixture({ stock: 6 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      // Simulate legacy data: the variant document is gone while the order lives.
      await VariantModel.deleteOne({ _id: fixture.variant }).exec();

      await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'STOCK_RESTORE_FAILED');
        return true;
      });

      const reloaded = await OrderModel.findById(order.id).lean().exec();
      assert.ok(reloaded);
      assert.equal(reloaded.status, 'pending', 'order stays pending — nothing was cancelled');
      assert.equal(reloaded.stockRestored, false);
    });
  });

  // ---- B1 -----------------------------------------------------------------
  describe('B1 — cart mutations during checkout', () => {
    it('rejects every cart mutation while a checkout claim is active', async () => {
      const fixture = await makeFixture({ stock: 5 });
      const second = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await CartModel.updateOne(
        { user: fixture.user._id },
        { $set: { checkoutInProgress: new Date() } },
      ).exec();

      const expectBusy = async (operation: Promise<unknown>) => {
        await assert.rejects(operation, (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'CHECKOUT_IN_PROGRESS');
          return true;
        });
      };

      await expectBusy(addItem(fixture.user._id, second.toString(), 1));
      await expectBusy(updateItem(fixture.user._id, fixture.variant.toString(), 2));
      await expectBusy(removeItem(fixture.user._id, fixture.variant.toString()));
      await expectBusy(clearCart(fixture.user._id));
      await expectBusy(mergeGuestItems(fixture.user._id, [{ variantId: second.toString(), quantity: 1 }]));

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.ok(cart);
      assert.equal(cart.items.length, 1, 'cart unchanged while checkout is in progress');
      assert.equal(cart.items[0]?.quantity, 1);
    });

    it('accepts mutations once the claim is stale (crashed checkout recovery)', async () => {
      const fixture = await makeFixture({ stock: 5 });
      const second = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      await CartModel.updateOne(
        { user: fixture.user._id },
        {
          $set: {
            checkoutInProgress: new Date(Date.now() - CHECKOUT_CLAIM_STALE_MS - 5_000),
            version: 0,
          },
        },
      ).exec();

      const view = await addItem(fixture.user._id, second.toString(), 1);
      assert.equal(view.items.length, 2);

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.version, 1, 'version bumped by the successful mutation');
    });

    it('never loses an item added concurrently with checkout', async () => {
      for (let round = 0; round < 5; round += 1) {
        await resetTestDatabase();
        const fixture = await makeFixture({ stock: 5 });
        const concurrent = await addSecondVariant(fixture, 5);
        await addItem(fixture.user._id, fixture.variant.toString(), 1);

        const [orderResult, addResult] = await Promise.allSettled([
          placeOrder(fixture.user),
          addItem(fixture.user._id, concurrent.toString(), 1),
        ]);

        if (addResult.status === 'rejected') {
          assert.ok(addResult.reason instanceof AppError);
          assert.equal(addResult.reason.code, 'CHECKOUT_IN_PROGRESS');
        }

        const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
        const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();

        const cartQty = (variant: Types.ObjectId): number =>
          cart?.items
            .filter((item) => item.variant.equals(variant))
            .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
        const orderQty = (variant: Types.ObjectId): number =>
          orders
            .flatMap((order) => order.items)
            .filter((item) => item.variant.equals(variant))
            .reduce((sum, item) => sum + item.quantity, 0);

        // The original line is accounted exactly once: in the order or still in the cart.
        assert.equal(cartQty(fixture.variant) + orderQty(fixture.variant), 1);

        if (addResult.status === 'fulfilled') {
          assert.equal(
            cartQty(concurrent) + orderQty(concurrent),
            1,
            'a concurrently added item survives in the cart or the order',
          );
        }

        if (orderResult.status === 'fulfilled') {
          assert.equal(orders.length, 1);
          assert.equal(cart?.items.length ?? 0, addResult.status === 'fulfilled' ? cartQty(concurrent) : 0);
        }

        for (const variant of await VariantModel.find({
          _id: { $in: [fixture.variant, concurrent] },
        })
          .lean()
          .exec()) {
          assert.ok(variant.stock >= 0, 'stock never goes negative');
        }
      }
    });

    it('replays a checkoutId without a second order or stock decrement', async () => {
      const fixture = await makeFixture({ stock: 8 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const checkoutId = randomUUID();
      const first = await placeOrder(fixture.user, checkoutId);
      const second = await placeOrder(fixture.user, checkoutId);

      assert.equal(first.id, second.id);
      assert.equal(await OrderModel.countDocuments({ checkoutId }).exec(), 1);
      assert.equal(await stockOf(fixture.variant), 6, 'stock decremented exactly once');
    });
  });

  // ---- B2 -----------------------------------------------------------------
  describe('B2 — first cart creation race', () => {
    it('creates exactly one cart for many concurrent first requests', async () => {
      const tag = unique('race');
      const user = await UserModel.create({
        email: `${tag}@example.com`,
        name: 'Race User',
        role: 'customer',
      });

      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => getCart(user._id)),
      );

      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(
        rejected.length,
        0,
        `no first-cart request may fail: ${rejected
          .map((result) => String((result as PromiseRejectedResult).reason))
          .join(' | ')}`,
      );
      assert.equal(await CartModel.countDocuments({ user: user._id }).exec(), 1);
      for (const result of results) {
        assert.equal(result.status, 'fulfilled');
        if (result.status === 'fulfilled') {
          assert.deepEqual(result.value.items, []);
        }
      }
    });

    it('keeps carts isolated per user', async () => {
      const first = await makeFixture({ stock: 3 });
      const second = await makeFixture({ stock: 3 });
      await addItem(first.user._id, first.variant.toString(), 2);

      const firstCart = await CartModel.findOne({ user: first.user._id }).lean().exec();
      const secondCart = await CartModel.findOne({ user: second.user._id }).lean().exec();

      assert.equal(secondCart, null, 'another user has no cart until they use one');
      assert.equal(firstCart?.items.length, 1);
      const secondView = await getCart(second.user._id);
      assert.deepEqual(secondView.items, []);
    });
  });

  // ---- B3 -----------------------------------------------------------------
  describe('B3 — checkout rejects unorderable lines', () => {
    const expectNotOrderable = async (promise: Promise<unknown>, pattern: RegExp) => {
      await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'CART_NOT_ORDERABLE');
        assert.equal(error.statusCode, 409);
        const details = error.details as Array<{ path: string; message: string }> | undefined;
        assert.ok(Array.isArray(details) && details.length > 0, 'per-line details are returned');
        assert.match(details[0]?.message ?? '', pattern);
        return true;
      });
    };

    it('rejects an archived variant and leaves the cart and stock untouched', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await VariantModel.updateOne(
        { _id: fixture.variant },
        { $set: { archivedAt: new Date() } },
      ).exec();

      await expectNotOrderable(placeOrder(fixture.user), /no longer sold/);

      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 5);
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1, 'cart is preserved for the shopper to fix');
      assert.equal(cart?.checkoutInProgress, null, 'claim released after the failure');
    });

    it('rejects a product that is no longer published', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await ProductModel.updateOne({ _id: fixture.product }, { $set: { status: 'draft' } }).exec();

      await expectNotOrderable(placeOrder(fixture.user), /not available/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
    });

    it('rejects a quantity above stock with the available amount', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 3);
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { stock: 1 } }).exec();

      await expectNotOrderable(placeOrder(fixture.user), /only 1 left in stock/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 1);
    });

    it('rejects a line without a usable price instead of creating a ৳0 order', async () => {
      const fixture = await makeFixture({ stock: 5, basePrice: 0, price: null });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      await expectNotOrderable(placeOrder(fixture.user), /price is unavailable/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
    });

    it('rejects a cart line with a non-positive quantity', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      // Bypass schema validation to simulate corrupt/legacy data.
      await CartModel.collection.updateOne(
        { user: fixture.user._id },
        { $set: { 'items.0.quantity': 0 } },
      );

      await expectNotOrderable(placeOrder(fixture.user), /quantity is not valid/);
      assert.equal(await OrderModel.countDocuments().exec(), 0);
      assert.equal(await stockOf(fixture.variant), 5);
    });

    it('still places a valid COD order with server-computed prices', async () => {
      const fixture = await makeFixture({ stock: 5, basePrice: 10000, price: 12000 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const order = await placeOrder(fixture.user);

      assert.equal(order.status, 'pending');
      assert.equal(order.paymentMethod, 'cod');
      assert.equal(order.items.length, 1);
      assert.equal(order.items[0]?.unitPrice, 12000, 'variant price override wins');
      assert.equal(order.subtotal, 24000);
      assert.equal(order.total, 24000);
      assert.equal(order.items[0]?.sku, fixture.sku, 'snapshot keeps the SKU');
      assert.equal(order.items[0]?.name.startsWith('Product '), true);
      assert.equal(await stockOf(fixture.variant), 3);

      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 0, 'cart cleared after checkout');
    });
  });

  // ---- Transaction atomicity / claim recovery -----------------------------
  describe('A1/B1 — transaction failure and claim recovery', () => {
    type CreateFn = typeof OrderModel.create;

    /** Test seam: make the order insert fail after the stock decrements. */
    const failOrderInsert = (): (() => void) => {
      const original = OrderModel.create.bind(OrderModel);
      (OrderModel as unknown as { create: CreateFn }).create = (() => {
        throw new Error('forced order insert failure');
      }) as unknown as CreateFn;
      return () => {
        (OrderModel as unknown as { create: CreateFn }).create = original as unknown as CreateFn;
      };
    };

    it('rolls the whole checkout back when the order insert fails after the decrement', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);

      const restore = failOrderInsert();
      try {
        await assert.rejects(placeOrder(fixture.user), /forced order insert failure/);
      } finally {
        restore();
      }

      assert.equal(await stockOf(fixture.variant), 5, 'the stock decrement was rolled back');
      assert.equal(await OrderModel.countDocuments().exec(), 0, 'no partial order was written');
      const cart = await CartModel.findOne({ user: fixture.user._id }).lean().exec();
      assert.equal(cart?.items.length, 1, 'cart is untouched');
      assert.equal(cart?.checkoutInProgress, null, 'claim released after the failure');

      // Recovery: an immediate retry succeeds with the correct stock delta.
      const order = await placeOrder(fixture.user);
      assert.equal(order.items.length, 1);
      assert.equal(await stockOf(fixture.variant), 3);
    });

    it('restores stock exactly once and rejects a second cancellation', async () => {
      const fixture = await makeFixture({ stock: 6 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 5);

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 6);

      await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        return true;
      });
      assert.equal(await stockOf(fixture.variant), 6, 'no second restore');

      const reloaded = await OrderModel.findById(order.id).lean().exec();
      assert.equal(reloaded?.stockRestored, true);
    });
  });

  // ---- Concurrency between order lifecycle and catalog changes -------------
  describe('A5 — checkout/cancel racing a variant deletion', () => {
    it('keeps the invariant when a cancellation and a deletion race', async () => {
      const fixture = await makeFixture({ stock: 6 });
      const sibling = await addSecondVariant(fixture, 5);
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 4);

      const [cancelResult] = await Promise.allSettled([
        cancelOrder(fixture.user, order.id),
        deleteVariant(fixture.variant.toString()),
      ]);

      const reloadedOrder = await OrderModel.findById(order.id).lean().exec();
      const variant = await VariantModel.findById(fixture.variant).lean().exec();

      if (cancelResult.status === 'fulfilled') {
        assert.equal(reloadedOrder?.status, 'cancelled');
        assert.equal(reloadedOrder?.stockRestored, true);
        assert.ok(variant, 'a variant referenced by an order is never hard-deleted');
        assert.ok(variant?.archivedAt instanceof Date);
        assert.equal(variant?.stock, 6, 'stock restored exactly once');
      } else {
        assert.ok(cancelResult.reason instanceof AppError);
        assert.equal(reloadedOrder?.status, 'pending');
        assert.equal(reloadedOrder?.stockRestored, false);
        if (variant) {
          assert.equal(variant.stock, 4, 'no partial restore');
        }
      }
      assert.equal(await stockOf(sibling), 5, 'unrelated variant untouched');
    });

    it('never commits an order that references a deleted variant', async () => {
      for (let round = 0; round < 4; round += 1) {
        await resetTestDatabase();
        const fixture = await makeFixture({ stock: 3 });
        await addSecondVariant(fixture, 3); // keeps the last-variant rule out of the way
        await addItem(fixture.user._id, fixture.variant.toString(), 1);

        const [orderResult, deleteResult] = await Promise.allSettled([
          placeOrder(fixture.user),
          deleteVariant(fixture.variant.toString()),
        ]);

        const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();
        const variant = await VariantModel.findById(fixture.variant).lean().exec();

        if (orders.length > 0) {
          assert.equal(orderResult.status, 'fulfilled');
          assert.ok(variant, 'a committed order must keep its variant document');
          assert.ok(variant?.archivedAt instanceof Date, 'and that variant is archived');
          assert.equal(variant?.stock, 2, 'decremented exactly once');
          assert.equal(orders[0]?.items[0]?.variant.toString(), fixture.variant.toString());
        } else {
          assert.equal(orderResult.status, 'rejected');
          assert.equal(deleteResult.status, 'fulfilled');
          assert.equal(variant, null, 'no order → the deletion may win and remove it');
        }
        if (variant) {
          assert.ok(variant.stock >= 0, 'stock never negative');
        }
      }
    });
  });

  // ---- Duplicate-key policy ------------------------------------------------
  describe('B2 — duplicate-key policy', () => {
    it('does not suppress unrelated errors and rethrows an unrecoverable duplicate key', async () => {
      const user = await UserModel.create({
        email: `${unique('b2')}@example.com`,
        name: 'B2 User',
        role: 'customer',
      });
      type InsertFn = typeof CartModel.findOneAndUpdate;
      const original = CartModel.findOneAndUpdate.bind(CartModel);

      const patchInsert = (error: unknown): void => {
        (CartModel as unknown as { findOneAndUpdate: InsertFn }).findOneAndUpdate = (() => ({
          exec: async () => {
            throw error;
          },
        })) as unknown as InsertFn;
      };
      const restore = (): void => {
        (CartModel as unknown as { findOneAndUpdate: InsertFn }).findOneAndUpdate =
          original as unknown as InsertFn;
      };

      try {
        patchInsert(Object.assign(new Error('boom'), { code: 121 }));
        await assert.rejects(getCart(user._id), /boom/);

        patchInsert(Object.assign(new Error('dup'), { code: 11000 }));
        await assert.rejects(getCart(user._id), /dup/);
      } finally {
        restore();
      }

      // The real race path still recovers: the competing cart exists.
      await CartModel.create({ user: user._id, items: [] });
      const view = await getCart(user._id);
      assert.deepEqual(view.items, []);
      assert.equal(await CartModel.countDocuments({ user: user._id }).exec(), 1);
    });
  });

  // ---- R1 (P1): archived variant restoration ------------------------------
  describe('R1 — archived variant restoration', () => {
    it('serialises repeated restores and concurrent restore/delete without losing history or stock', async () => {
      for (let round = 0; round < 4; round += 1) {
        await resetTestDatabase();
        const fixture = await makeFixture({ stock: 5 });
        await addItem(fixture.user._id, fixture.variant.toString(), 1);
        const historical = await placeOrder(fixture.user);
        await deleteVariant(fixture.variant.toString());
        const repeated = await Promise.all([
          restoreVariant(fixture.variant.toString()), restoreVariant(fixture.variant.toString()),
        ]);
        assert.equal(repeated[0]?.id, repeated[1]?.id);
        await deleteVariant(fixture.variant.toString());
        await Promise.all([restoreVariant(fixture.variant.toString()), deleteVariant(fixture.variant.toString())]);
        const variant = await VariantModel.findById(fixture.variant).lean().exec();
        assert.ok(variant);
        assert.equal(variant.sku, fixture.sku);
        assert.equal(variant.stock, 4);
        assert.equal(await VariantModel.countDocuments({ product: fixture.product }), 1);
        assert.equal((await OrderModel.findById(historical.id))?.items[0]?.variant.toString(), fixture.variant.toString());
        await cancelOrder(fixture.user, historical.id);
        assert.equal(await stockOf(fixture.variant), 5);
      }
    });

    it('refuses an orphaned variant with HTTP-style conflict and preserves the archived document', async () => {
      const fixture = await makeFixture();
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      await ProductModel.deleteOne({ _id: fixture.product });
      await assert.rejects(restoreVariant(fixture.variant.toString()), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        return true;
      });
      assert.ok((await VariantModel.findById(fixture.variant))?.archivedAt);
      assert.equal(await stockOf(fixture.variant), 10);
    });

    it('keeps draft and archived parents unpublished and retains full unique indexes', async () => {
      const fixture = await makeFixture();
      for (const status of ['draft', 'archived'] as const) {
        await ProductModel.updateOne({ _id: fixture.product }, { $set: { status } });
        await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
        await assert.rejects(createVariant(fixture.product.toString(), {
          sku: `${fixture.sku}-DUP`, size: 'M', color: null, stock: 1, lowStockThreshold: 5, images: [],
        }), (error: unknown) => error instanceof AppError && error.statusCode === 409);
        await restoreVariant(fixture.variant.toString());
        assert.equal((await ProductModel.findById(fixture.product))?.status, status);
      }
      const indexes = await VariantModel.collection.indexes();
      const combo = indexes.find((index) => index.key.product === 1 && index.key.size === 1 && index.key.color === 1);
      assert.equal(combo?.unique, true);
      assert.equal(combo?.partialFilterExpression, undefined);
    });

    it('cannot leave a restored orphan when product deletion races restoration', async () => {
      const fixture = await makeFixture();
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      const [, deletion] = await Promise.allSettled([
        restoreVariant(fixture.variant.toString()), deleteProduct(fixture.product.toString()),
      ]);
      assert.equal(deletion.status, 'fulfilled');
      assert.equal(await ProductModel.findById(fixture.product), null);
      assert.equal(await VariantModel.findById(fixture.variant), null);
    });
    it('restores the same document and the variant becomes sellable again', async () => {
      const fixture = await makeFixture({ stock: 4 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const historical = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 3);

      const archived = await deleteVariant(fixture.variant.toString());
      assert.equal(archived.archived, true);

      const restored = await restoreVariant(fixture.variant.toString());
      assert.equal(restored.id, fixture.variant.toString(), 'same _id');
      assert.equal(restored.sku, fixture.sku, 'same SKU');
      assert.equal(restored.stock, 3, 'stock preserved');
      assert.equal(restored.archivedAt, null);

      // Sellable again: the cart accepts it and a new checkout succeeds.
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const reordered = await placeOrder(fixture.user);
      assert.equal(reordered.items[0]?.variant, fixture.variant.toString());
      assert.equal(await stockOf(fixture.variant), 2);

      // The historical order still restores exactly its own quantity.
      const cancelled = await cancelOrder(fixture.user, historical.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 3);
    });

    it('is idempotent for an already-active variant', async () => {
      const fixture = await makeFixture({ stock: 2 });
      const before = await VariantModel.findById(fixture.variant).lean().exec();

      const first = await restoreVariant(fixture.variant.toString());
      const second = await restoreVariant(fixture.variant.toString());

      assert.equal(first.id, second.id);
      const after = await VariantModel.findById(fixture.variant).lean().exec();
      assert.equal(after?._id.toString(), before?._id.toString());
      assert.equal(after?.stock, 2);
      assert.equal(after?.archivedAt, null);
      assert.equal(await VariantModel.countDocuments({ product: fixture.product }).exec(), 1);
    });

    it('restores a variant referenced by a historical order without breaking cancellation', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 2);
      const order = await placeOrder(fixture.user);

      await deleteVariant(fixture.variant.toString());
      await restoreVariant(fixture.variant.toString());

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 5, 'restored exactly once');
    });

    it('serialises a restore against a concurrent checkout', async () => {
      const fixture = await makeFixture({ stock: 5 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);

      // An existing order makes deletion archive the variant instead of deleting it.
      const first = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 4);
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await deleteVariant(fixture.variant.toString());

      const [restoreResult, orderResult] = await Promise.allSettled([
        restoreVariant(fixture.variant.toString()),
        placeOrder(fixture.user),
      ]);

      assert.equal(restoreResult.status, 'fulfilled', 'restore is never lost in the race');
      const variant = await VariantModel.findById(fixture.variant).lean().exec();
      assert.ok(variant, 'the variant document always survives');
      assert.equal(variant?._id.toString(), fixture.variant.toString());
      assert.equal(variant?.archivedAt, null, 'restore wins or is retried until it applies');

      const orders = await OrderModel.find({ user: fixture.user._id }).lean().exec();
      if (orderResult.status === 'fulfilled') {
        assert.equal(orders.length, 2);
        assert.equal(await stockOf(fixture.variant), 3, 'decremented exactly once');
      } else {
        assert.equal(orders.length, 1);
        assert.equal(await stockOf(fixture.variant), 4, 'no decrement for the rejected checkout');
        assert.ok(variant && variant.stock >= 0);
      }

      // Cleanup proof: the historical order still cancels correctly.
      await cancelOrder(fixture.user, first.id);
    });
  });

  // ---- P3: stock restoration success criterion ----------------------------
  describe('R4 — restore treats a zero-change update as success', () => {
    it('cancels an order whose line has quantity 0 without a false restore failure', async () => {
      const fixture = await makeFixture({ stock: 4 });
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const order = await placeOrder(fixture.user);
      assert.equal(await stockOf(fixture.variant), 3);

      // Corrupt/legacy data: a zero-quantity line ($inc: 0 matches but does not modify).
      await OrderModel.collection.updateOne(
        { _id: new Types.ObjectId(order.id) },
        { $set: { 'items.0.quantity': 0 } },
      );

      const cancelled = await cancelOrder(fixture.user, order.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await stockOf(fixture.variant), 3, 'nothing to restore, nothing broken');
    });
  });

  for (const actor of ['customer', 'admin'] as const) {
    const cancel = (user: UserDocument, id: string) => actor === 'customer'
      ? cancelOrder(user, id)
      : adminUpdateOrderStatus(user, id, { status: 'cancelled' });

    describe(`R4 — ${actor} cancellation invariants`, () => {
      it('accepts a matched zero-change result and prevents a second restoration', async (t) => {
        const fixture = await makeFixture({ stock: 4 });
        await addItem(fixture.user._id, fixture.variant.toString(), 1);
        const order = await placeOrder(fixture.user);
        await OrderModel.collection.updateOne({ _id: new Types.ObjectId(order.id) }, { $set: { 'items.0.quantity': 0 } });
        // Force the driver's legitimate matched-but-unmodified result. Mongoose
        // timestamps could otherwise make a real $inc:0 report a modification.
        t.mock.method(VariantModel, 'updateOne', (() => ({ exec: async () => ({ matchedCount: 1, modifiedCount: 0 }) })) as unknown as typeof VariantModel.updateOne);
        assert.equal((await cancel(fixture.user, order.id)).status, 'cancelled');
        await assert.rejects(cancel(fixture.user, order.id), (error: unknown) => error instanceof AppError && error.statusCode === 409);
        assert.equal(await stockOf(fixture.variant), 3);
        assert.equal((await OrderModel.findById(order.id))?.stockRestored, true);
      });

      it('rolls back earlier inventory and the status when a later variant is missing', async () => {
        const fixture = await makeFixture({ stock: 6 });
        const second = await addSecondVariant(fixture, 5);
        await addItem(fixture.user._id, fixture.variant.toString(), 2);
        await addItem(fixture.user._id, second.toString(), 1);
        const order = await placeOrder(fixture.user);
        await VariantModel.deleteOne({ _id: second });
        await assert.rejects(cancel(fixture.user, order.id), (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'STOCK_RESTORE_FAILED');
          assert.equal(error.statusCode, 409);
          return true;
        });
        assert.equal(await stockOf(fixture.variant), 4, 'the earlier stock increment was rolled back');
        const stored = await OrderModel.findById(order.id);
        assert.equal(stored?.status, 'pending');
        assert.equal(stored?.stockRestored, false);
        assert.equal(stored?.statusHistory.length, 1);
      });
    });
  }

  describe('HTTP — checkout conflicts and restore authorization', () => {
    const request = (user: UserDocument | null, path: string, method: string, body?: unknown) => fetch(`${origin}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: `al_token=${signAuthToken(user._id.toString(), user.role)}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const checkout = (user: UserDocument) => request(user, '/orders', 'POST', {
      checkoutId: randomUUID(), paymentMethod: 'cod', shippingAddress: {
        fullName: 'P0 Test User', phone: '01700000000', line1: 'House 1, Road 1', isDefault: true,
      },
    });

    it('returns 409 CART_NOT_ORDERABLE with per-line details', async () => {
      const fixture = await makeFixture();
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      const response = await checkout(fixture.user);
      assert.equal(response.status, 409);
      const body = await response.json() as { error: { code: string; details: unknown[] } };
      assert.equal(body.error.code, 'CART_NOT_ORDERABLE');
      assert.ok(body.error.details.length > 0);
      assert.equal(await OrderModel.countDocuments(), 0);
      assert.equal(await stockOf(fixture.variant), 10);
    });

    it('returns 409 CHECKOUT_IN_PROGRESS without changing stock', async () => {
      const fixture = await makeFixture();
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      await CartModel.updateOne({ user: fixture.user._id }, { $set: { checkoutInProgress: new Date() } });
      const response = await checkout(fixture.user);
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'CHECKOUT_IN_PROGRESS');
      assert.equal(await stockOf(fixture.variant), 10);
      assert.equal(await OrderModel.countDocuments(), 0);
    });

    it('returns 409 CHECKOUT_CONFLICT and rolls back stock, order and cart clearing', async (t) => {
      const fixture = await makeFixture();
      await addItem(fixture.user._id, fixture.variant.toString(), 1);
      const original = CartModel.updateOne.bind(CartModel);
      t.mock.method(CartModel, 'updateOne', ((...args: unknown[]) => {
        const update = args[1] as { $set?: { items?: unknown } };
        if (Array.isArray(update.$set?.items)) return { exec: async () => ({ matchedCount: 0 }) };
        return Reflect.apply(original, CartModel, args);
      }) as typeof CartModel.updateOne);
      const response = await checkout(fixture.user);
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'CHECKOUT_CONFLICT');
      assert.equal(await stockOf(fixture.variant), 10);
      assert.equal(await OrderModel.countDocuments(), 0);
      const cart = await CartModel.findOne({ user: fixture.user._id });
      assert.equal(cart?.items.length, 1);
      assert.equal(cart?.checkoutInProgress, null);
    });

    it('requires admin authentication, validates ids and restores through the real route', async () => {
      const fixture = await makeFixture();
      await VariantModel.updateOne({ _id: fixture.variant }, { $set: { archivedAt: new Date() } });
      const path = `/admin/variants/${fixture.variant.toString()}/restore`;
      assert.equal((await request(null, path, 'PATCH')).status, 401);
      assert.equal((await request(fixture.user, path, 'PATCH')).status, 403);
      assert.ok((await VariantModel.findById(fixture.variant))?.archivedAt);
      fixture.user.role = 'admin';
      await fixture.user.save();
      assert.equal((await request(fixture.user, '/admin/variants/invalid/restore', 'PATCH')).status, 400);
      const response = await request(fixture.user, path, 'PATCH');
      assert.equal(response.status, 200);
      const body = await response.json() as { variant: { id: string; archivedAt: null; stock: number; sku: string } };
      assert.equal(body.variant.id, fixture.variant.toString());
      assert.equal(body.variant.archivedAt, null);
      assert.equal(body.variant.stock, 10);
      assert.equal(body.variant.sku, fixture.sku);
    });
  });
});


```

### Final new file: `server/test/setup-env.ts`

```ts
/**
 * Test environment bootstrap. MUST be the first import in every server test file:
 * `src/config/env.ts` validates `process.env` at import time.
 *
 * Integration tests fail closed unless both disposable mode and a safe local
 * test URI are configured. See `server/test/README.md`.
 */
const testUri = (process.env.MONGODB_TEST_URI ?? '').trim();

process.env.NODE_ENV = 'test';
// env.ts requires a URI/JWT/admin credentials even for tests; the placeholder is
// only satisfies env validation; no integration helper uses this as a fallback.
process.env.MONGODB_URI =
  testUri.length > 0 ? testUri : 'mongodb://127.0.0.1:27017/abstract_lifestyle_p0_unavailable';
process.env.JWT_SECRET = 'test-jwt-secret-p0-'.padEnd(48, 'x');
process.env.CLIENT_ORIGIN = 'http://localhost:3000';
process.env.SHIPPING_FEE = '0';
process.env.ADMIN_EMAIL = 'p0-admin@example.com';
process.env.ADMIN_PASSWORD = 'p0-test-admin-password';

```

### Final new file: `server/test/test-database-guard.test.ts`

```ts
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import {
  assertSafeTestTarget,
  assertSafeTestUri,
  UnsafeTestDatabaseError,
  requireTestDatabaseConfig,
} from './guards/test-database.js';
import { connectTestDatabase, disconnectTestDatabase, resetTestDatabase } from './helpers/test-db.js';
import { mockConnection } from './helpers/mock-connection.js';

const refuses = (operation: () => void, pattern: RegExp): void => {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof UnsafeTestDatabaseError, 'a typed refusal is raised');
    assert.match(error.message, pattern);
    assert.match(error.message, /No records were deleted|designated/, 'message states nothing was deleted');
    return true;
  });
};

describe('R2 — destructive test-database guard', () => {
  it('refuses a missing test configuration', () => {
    refuses(() => assertSafeTestUri(''), /not set/);
  });

  it('refuses a non-mongodb scheme', () => {
    refuses(() => assertSafeTestUri('postgres://127.0.0.1/db_test'), /mongodb:\/\//);
  });

  it('refuses an application database without the _test suffix', () => {
    refuses(
      () => assertSafeTestUri('mongodb://127.0.0.1:27018/abstract_lifestyle'),
      /must be named "\*_test"/,
    );
    refuses(
      () => assertSafeTestTarget({ databaseName: 'abstract_lifestyle', host: '127.0.0.1' }),
      /must be named "\*_test"/,
    );
  });

  it('refuses production/staging-looking names even with the suffix', () => {
    for (const name of ['shop_prod_test', 'staging_catalog_test', 'live_test']) {
      refuses(
        () => assertSafeTestTarget({ databaseName: name, host: '127.0.0.1' }),
        /production|staging|live|prod/i,
      );
    }
  });

  it('refuses the reserved application/system database names themselves', () => {
    for (const name of ['abstract_lifestyle', 'admin', 'config', 'local']) {
      refuses(
        () => assertSafeTestTarget({ databaseName: name, host: '127.0.0.1' }),
        /must be named/,
      );
    }
  });

  it('refuses a remote host', () => {
    refuses(
      () =>
        assertSafeTestTarget({
          databaseName: 'p0_integrity_test',
          host: 'cluster0.abc.mongodb.net',
        }),
      /remote host/,
    );
  });

  it('accepts only a local disposable test database', () => {
    assert.doesNotThrow(() =>
      assertSafeTestTarget({ databaseName: 'p0_integrity_test', host: '127.0.0.1' }),
    );
    assert.doesNotThrow(() =>
      assertSafeTestUri(
        'mongodb://127.0.0.1:27018/p0_integrity_test?replicaSet=rs0&directConnection=true',
      ),
    );
  });
});

describe('R2 — refusal cannot delete records (in-memory driver double)', () => {
  const keys = ['MONGODB_TEST_MODE', 'MONGODB_TEST_URI', 'MONGODB_TEST_ALLOW_REMOTE', 'MONGODB_URI'] as const;
  let saved: Array<string | undefined>;
  let records: number;
  let listings: number;
  const db = {
    databaseName: 'p0_integrity_test',
    collections: async () => {
      listings += 1;
      return [{ deleteMany: async () => { records = 0; } }];
    },
  };
  beforeEach(() => {
    saved = keys.map((key) => process.env[key]);
    process.env.MONGODB_TEST_MODE = 'disposable';
    process.env.MONGODB_TEST_URI = 'mongodb://127.0.0.1:27018/p0_integrity_test';
    records = 3;
    listings = 0;
    db.databaseName = 'p0_integrity_test';
  });
  afterEach(async () => {
    await disconnectTestDatabase();
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  it('requires intentional mode before opening a connection', async (t) => {
    const connect = mockConnection(t, db);
    delete process.env.MONGODB_TEST_MODE;
    await assert.rejects(connectTestDatabase(), /MONGODB_TEST_MODE/);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('never falls back to MONGODB_URI when test configuration is missing', async (t) => {
    const connect = mockConnection(t, db);
    delete process.env.MONGODB_TEST_URI;
    process.env.MONGODB_URI = 'mongodb://127.0.0.1/application_production';
    await assert.rejects(connectTestDatabase(), /MONGODB_TEST_URI is not set/);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a production-like URI despite explicit disposable mode', async (t) => {
    const connect = mockConnection(t, db);
    process.env.MONGODB_TEST_URI = 'mongodb://127.0.0.1/shop_production_test';
    await assert.rejects(connectTestDatabase(), /production\/staging/);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a production-like resolved name even when the URI is safe', async (t) => {
    db.databaseName = 'shop_prod_test';
    mockConnection(t, db);
    await assert.rejects(connectTestDatabase(), /unsafe target/);
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a different resolved test database', async (t) => {
    db.databaseName = 'another_test';
    mockConnection(t, db);
    await assert.rejects(connectTestDatabase(), /unsafe target/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('refuses a resolved remote target despite the old opt-in', async (t) => {
    mockConnection(t, db, 'staging.example.com');
    process.env.MONGODB_TEST_ALLOW_REMOTE = '1';
    await assert.rejects(connectTestDatabase(), /unsafe target/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('checks configuration again immediately before a reset', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    delete process.env.MONGODB_TEST_MODE;
    await assert.rejects(resetTestDatabase(), /MONGODB_TEST_MODE/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('checks the actual resolved database again immediately before a reset', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    db.databaseName = 'staging_test';
    await assert.rejects(resetTestDatabase(), /production\/staging/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('allows a guarded reset of the approved disposable database', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    await resetTestDatabase();
    assert.equal(records, 0);
    assert.equal(listings, 1);
  });
  it('refuses a replacement Db object even if it has the same safe name', async (t) => {
    mockConnection(t, db);
    await connectTestDatabase();
    Object.defineProperty(mongoose.connection, 'db', { value: { ...db }, configurable: true, writable: true });
    await assert.rejects(resetTestDatabase(), /not the approved/);
    assert.equal(records, 3);
    assert.equal(listings, 0);
  });
  it('does not disclose credentials in validation failures', () => {
    assert.throws(
      () => requireTestDatabaseConfig({ MONGODB_TEST_MODE: 'disposable', MONGODB_TEST_URI: 'mongodb://private-user:private-password@staging.example.com/shop_prod_test' }),
      (error: unknown) => {
        assert.ok(error instanceof UnsafeTestDatabaseError);
        assert.doesNotMatch(error.message, /private-user|private-password/);
        return true;
      },
    );
  });
});

```

### Final new file: `server/test/topology-guard.test.ts`

```ts
import './setup-env.js';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDB, disconnectDB, getDeploymentCapabilities } from '../src/config/db.js';
import { OrderModel } from '../src/models/order.model.js';
import { assertSafeTestUri, requireTestDatabaseConfig } from './guards/test-database.js';

const replicaSetUri = (process.env.MONGODB_TEST_URI ?? '').trim();
const standaloneUri = (process.env.MONGODB_STANDALONE_URI ?? '').trim();

const skipStandalone: string | false =
  standaloneUri.length > 0
    ? false
    : 'MONGODB_STANDALONE_URI is not set — start a plain mongod (no --replSet) to exercise the guard';

describe('A1 — startup refuses a deployment without transactions', { skip: skipStandalone }, () => {
  after(async () => {
    await disconnectDB().catch(() => undefined);
  });

  it('fails with an actionable diagnostic and leaves no usable connection', async () => {
    requireTestDatabaseConfig();
    assertSafeTestUri(standaloneUri);
    await assert.rejects(connectDB({ uri: standaloneUri }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /cannot run order transactions/);
      assert.match(error.message, /--replSet rs0/);
      assert.match(error.message, /rs\.initiate/);
      return true;
    });

    assert.equal(mongoose.connection.readyState, 0, 'connection is closed after the refusal');
    assert.equal(getDeploymentCapabilities(), null, 'no capability is published');

    // No order writes are possible: the driver cannot reach a database.
    await assert.rejects(OrderModel.countDocuments().exec());
  });
});

describe('A1 — startup accepts a replica set', () => {
  after(async () => {
    await disconnectDB().catch(() => undefined);
  });

  it('connects, reports transaction support and answers a ping', async () => {
    requireTestDatabaseConfig();
    assertSafeTestUri(replicaSetUri);
    await connectDB({ uri: replicaSetUri });

    const capabilities = getDeploymentCapabilities();
    assert.ok(capabilities);
    assert.equal(capabilities.transactions, true);
    assert.ok(
      capabilities.kind === 'replica-set' || capabilities.kind === 'sharded',
      `unexpected topology: ${capabilities.detail}`,
    );

    const ping = await mongoose.connection.db?.admin().command({ ping: 1 });
    assert.equal(ping?.ok, 1);
  });
});

```

### Final new file: `server/tsconfig.test.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "test", "test/**/*"]
}

```
