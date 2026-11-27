# Phase 1 review package — final corrective snapshot

Original Phase 0 baseline: `c389bace330824c4373dadf548d2063e68249173`
Current HEAD: `687115016c0c8855fcf1450d9f91644b196f996c` (`6871150`)
Branch: `fix/audit-p1-business-functionality`

Full uncommitted tracked diff (25 paths), plus all seven new source/test files: 32 implementation/documentation candidates. Committed Phase 0 and the type-only build fix are outside this patch. Excludes private env/credentials, runtime data, generated output, reports, original audit and unrelated files. See `AUDIT_PHASE1_IMPLEMENTATION_REPORT.md` section 10 for current results (83 server + 35 client + 7 browser), file allowlist and residual release conditions. No staging or commit authorized/performed.

## Tracked diff

````diff
diff --git a/API_DOCUMENTATION.md b/API_DOCUMENTATION.md
index 9aec53d..92ff08e 100644
--- a/API_DOCUMENTATION.md
+++ b/API_DOCUMENTATION.md
@@ -17,7 +17,7 @@ Codes: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_F
 | POST /auth/google | public | `{ credential }` (Google Identity Services ID token, max 4096 chars) | 200 `{ user }` + `Set-Cookie: al_token` |
 | POST /auth/logout | public (clears cookie even with expired token) | — | 204 — clears the `al_token` cookie |
 | GET /users/me | customer | — | 200 `{ user }` |
-| PATCH /users/me | customer | `{ name? }` | 200 `{ user }` |
+| PATCH /users/me | customer | `{ name }` | 200 `{ user }` |
 | GET /users/me/addresses | customer | — | 200 `{ items: [Address] }` |
 | POST /users/me/addresses | customer | Address fields | 201 `{ address }` |
 | PATCH /users/me/addresses/:id | customer | partial Address | 200 `{ address }` |
@@ -25,6 +25,17 @@ Codes: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_F
 
 `user` = `{ id, email, name, role, addresses }` — never includes passwordHash or googleId. Logout = `POST /auth/logout` clears the httpOnly cookie server-side (client JS cannot).
 
+Address mutations are scoped to the authenticated account and serialized through
+transactions. A nonempty address list has exactly one default: the first address
+becomes default automatically, setting another clears the old default, and deleting
+the default promotes the first remaining address. Address/profile changes never
+rewrite historical order delivery snapshots. Foreign address ids return 404.
+
+Optional address strings are `label`, `line2`, `city`, `state`, `postalCode` and
+`country`. In PATCH, omitting a field preserves it; sending `""` (or whitespace,
+trimmed by validation) intentionally clears it to an empty string in MongoDB.
+Required fields cannot be cleared. `isDefault` is an optional boolean, not a string.
+
 **Google sign-in (`POST /auth/google`):** the `credential` is a Google Identity Services ID token, verified server-side with `google-auth-library` (`verifyIdToken`, audience = `GOOGLE_CLIENT_ID`). **Any** verification failure (bad signature, expired, wrong audience, unverified email, missing claims) returns the same generic `401 { error: { code: "UNAUTHORIZED", message: "Google sign-in failed" } }`. Only `email_verified === true` tokens are accepted. Lookup order: `googleId` match → normalized-email match (the Google account is then **linked** to the existing user — safe because the email is Google-verified; password and role are untouched) → new **customer** account is created (name/email from the token; role is always `customer`, never taken from the token or request). Successful sign-in behaves exactly like `POST /auth/login`: user DTO in the body (never a token) + the same `al_token` HttpOnly cookie. Rate-limited like the other credential endpoints (10/15 min per IP). Google-only accounts (no password) cannot use `POST /auth/login` — it fails with the same generic `Invalid email or password` error as a wrong password.
 
 ## Catalog (public)
@@ -59,7 +70,7 @@ Cart notes: prices/stock are always recomputed from the DB (`unitPrice = variant
 | POST /orders | `{ checkoutId (UUID), shippingAddressId }` OR `{ checkoutId, shippingAddress: {...} }`, `paymentMethod: 'cod'` | 201 `{ order }`; 409 `CART_NOT_ORDERABLE` (with per-line `details[]`) when any line is archived/unpublished/out of stock/priceless, 409 `CHECKOUT_IN_PROGRESS`, 409 `CHECKOUT_CONFLICT` when the cart changed mid-checkout. Idempotent: replaying the same `checkoutId` returns the existing order |
 | GET /orders | `?page&limit` | 200 list envelope (own orders, newest first) |
 | GET /orders/:id | — | 200 `{ order }` (own or admin) |
-| POST /orders/:id/cancel | — | 200 `{ order }` — customer cancel only from `pending`; restores stock exactly once (double-cancel safe); 409 otherwise |
+| POST /orders/:id/cancel | — | 200 `{ order }` — owner cancellation from `pending` or `processing`, before shipment; atomically restores stock exactly once; 409 after shipment or repeat cancellation |
 
 Order JSON: `{ id, orderNumber, checkoutId, status, paymentMethod, paymentStatus, items[], shippingAddress, subtotal, shippingFee, total, statusHistory, createdAt }`. `items[]` = purchase-time snapshots `{ product, variant, name, sku, size, color, image, unitPrice, quantity, lineTotal }`. Checkout re-validates and re-prices everything from the DB (never accepts client items/prices); the per-line stock decrements, the order creation and the cart clear run in **one MongoDB transaction** (Atlas replica set), so any failure aborts everything; concurrent checkouts on the same cart are rejected with 409. `checkoutId` is a client-generated UUID stored under a unique (sparse) index — a repeated request with the same `checkoutId` returns the original order instead of creating a second one.
 
@@ -86,7 +97,7 @@ Sale pricing (admin): `POST/PATCH /admin/products` accept `compareAtPrice` (inte
 | POST /admin/uploads/destroy | `{ publicIds: string[] }` (1–20, own folder only) | 204 — deletes assets that were uploaded but never attached to a saved product (best-effort) |
 | GET /admin/site-images | — | 200 `{ items: [{ key, image }] }` — all marketing slots in canonical order |
 | PUT /admin/site-images/:key | `{ image: { url, publicId } \| null }` (`:key` = hero \| promo-1 \| promo-2) | 200 `{ item }` — upserts the slot; `null` clears it (replaces/removes destroy the previous Cloudinary asset, best-effort) |
-| GET /admin/orders | `?status&page&limit` | 200 list envelope (all orders) |
+| GET /admin/orders | `?search&status&page&limit` | Admin only; exact complete order-number or normalized Bangladesh mobile lookup (+880/880/local); status-filtered, stable pagination. Invalid/partial queries return 400; no unrestricted regex search. |
 | GET /admin/orders/:id | — | 200 `{ order, customer: { id, name, email } \| null }` (any user's order) |
 | PATCH /admin/orders/:id/status | `{ status }` | 200 `{ order }` |
 | GET /admin/customers | `?search&page&limit` | 200 list envelope |
diff --git a/DEPLOYMENT.md b/DEPLOYMENT.md
index a2b69e3..07a777a 100644
--- a/DEPLOYMENT.md
+++ b/DEPLOYMENT.md
@@ -57,6 +57,20 @@ Set the **server** env table above (Production) in the Render dashboard; `TRUST_
 
 ### Local database (replica set required)
 
+Phase 1 seed safety: newly inserted demo products are drafts until legitimate images
+and variants satisfy the existing publishing rules. Repeat seeding preserves existing
+password hashes, product edits and inventory. All new password hashes use cost 12.
+Existing lower-cost admin hashes require verified-owner credential rotation through a
+controlled maintenance process: hash a new strong password with the shared cost 12,
+never rehash the old hash or print plaintext credentials. Rerunning the seed does not
+rotate credentials. Do not run demo seeding against production.
+
+Admin order search accepts a complete order number or a complete Bangladesh mobile
+number (local, +880 or 880 format), combined with status and pagination. Deploy the
+new `shippingAddress.phone/createdAt/_id` and `shippingAddress.phone/status/createdAt/_id`
+indexes through the normal database index rollout before relying on large-catalog
+search performance. No migration or production index write was performed here.
+
 Order checkout, cancellation and admin variant/product deletion use multi-document transactions. The API **refuses to start** against a standalone `mongod` and prints the fix. Run a single-node replica set locally:
 
 ```bash
diff --git a/client/app/about/page.tsx b/client/app/about/page.tsx
index 594bbe4..b91540b 100644
--- a/client/app/about/page.tsx
+++ b/client/app/about/page.tsx
@@ -1,5 +1,4 @@
 import type { Metadata } from "next";
-import { Notice } from "@/components/ui/Notice";
 
 export const metadata: Metadata = {
   title: "About",
@@ -10,9 +9,6 @@ export default function AboutPage() {
   return (
     <div className="mx-auto max-w-3xl px-4 py-12">
       <h1 className="text-3xl font-semibold tracking-tight text-ink">About Abstract Lifestyle</h1>
-      <Notice tone="info" className="mt-4">
-        Placeholder content — edit this page in <code>app/about/page.tsx</code>.
-      </Notice>
       <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
         <p>
           Abstract Lifestyle is a small store for clothing and everyday lifestyle products:
@@ -22,7 +18,6 @@ export default function AboutPage() {
           We keep the catalog focused and the details honest — real stock counts, clear prices in
           BDT, and Cash on Delivery at checkout.
         </p>
-        <p>Replace this copy with your brand story, values and shipping promises.</p>
       </div>
     </div>
   );
diff --git a/client/app/contact/page.tsx b/client/app/contact/page.tsx
index 496dec7..1c68d5e 100644
--- a/client/app/contact/page.tsx
+++ b/client/app/contact/page.tsx
@@ -1,5 +1,5 @@
 import type { Metadata } from "next";
-import { Notice } from "@/components/ui/Notice";
+import { site } from '@/config/site';
 
 export const metadata: Metadata = {
   title: "Contact",
@@ -10,17 +10,10 @@ export default function ContactPage() {
   return (
     <div className="mx-auto max-w-3xl px-4 py-12">
       <h1 className="text-3xl font-semibold tracking-tight text-ink">Contact us</h1>
-      <Notice tone="info" className="mt-4">
-        Placeholder content — edit this page in <code>app/contact/page.tsx</code>.
-      </Notice>
       <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
         <p>Questions about an order, shipping or a product? We are happy to help.</p>
-        <p>
-          Email: <span className="font-medium text-ink">hello@example.com</span> (placeholder)
-          <br />
-          Hours: Saturday–Thursday, 10:00–18:00 (placeholder)
-        </p>
-        <p>Replace this with your real support email, phone and hours.</p>
+        {site.contact.email ? <p>Email: <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a></p> : <p>Online support contact details are not currently available.</p>}
+        {site.contact.hours ? <p>Hours: {site.contact.hours}</p> : null}
       </div>
     </div>
   );
diff --git a/client/app/privacy/page.tsx b/client/app/privacy/page.tsx
index 1a78799..223be8e 100644
--- a/client/app/privacy/page.tsx
+++ b/client/app/privacy/page.tsx
@@ -1,5 +1,4 @@
 import type { Metadata } from "next";
-import { Notice } from "@/components/ui/Notice";
 
 export const metadata: Metadata = {
   title: "Privacy",
@@ -10,17 +9,13 @@ export default function PrivacyPage() {
   return (
     <div className="mx-auto max-w-3xl px-4 py-12">
       <h1 className="text-3xl font-semibold tracking-tight text-ink">Privacy policy</h1>
-      <Notice tone="info" className="mt-4">
-        Placeholder content — edit this page in <code>app/privacy/page.tsx</code>.
-      </Notice>
       <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
         <p>
           We collect only what is needed to fulfil orders: your account details, shipping address
-          and order history. Authentication uses an httpOnly cookie.
+          and order history.
         </p>
         <p>
-          Replace this placeholder with your complete privacy policy, data-retention rules and
-          contact details for data requests.
+          Account details and saved addresses can be managed from your account page.
         </p>
       </div>
     </div>
diff --git a/client/app/shipping-returns/page.tsx b/client/app/shipping-returns/page.tsx
index 947b072..b9cf4a3 100644
--- a/client/app/shipping-returns/page.tsx
+++ b/client/app/shipping-returns/page.tsx
@@ -1,5 +1,4 @@
 import type { Metadata } from "next";
-import { Notice } from "@/components/ui/Notice";
 
 export const metadata: Metadata = {
   title: "Shipping & Returns",
@@ -10,18 +9,13 @@ export default function ShippingReturnsPage() {
   return (
     <div className="mx-auto max-w-3xl px-4 py-12">
       <h1 className="text-3xl font-semibold tracking-tight text-ink">Shipping &amp; Returns</h1>
-      <Notice tone="info" className="mt-4">
-        Placeholder content — edit this page in <code>app/shipping-returns/page.tsx</code>.
-      </Notice>
       <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
         <section aria-labelledby="shipping-heading">
           <h2 id="shipping-heading" className="text-base font-semibold text-ink">
             Shipping
           </h2>
           <p className="mt-2">
-            Orders are delivered by courier with Cash on Delivery. Delivery times and any flat
-            shipping fee are shown at checkout — replace this text with your real carrier and
-            timelines.
+            Orders use Cash on Delivery. The delivery fee is shown at checkout.
           </p>
         </section>
         <section aria-labelledby="returns-heading">
@@ -29,8 +23,7 @@ export default function ShippingReturnsPage() {
             Returns
           </h2>
           <p className="mt-2">
-            Tell customers how to return or exchange an item, the condition required and the time
-            window. Replace this placeholder with your actual policy.
+            Return and exchange terms are not currently published.
           </p>
         </section>
       </div>
diff --git a/client/components/admin/AdminOrders.tsx b/client/components/admin/AdminOrders.tsx
index 268f1e7..eb0cf35 100644
--- a/client/components/admin/AdminOrders.tsx
+++ b/client/components/admin/AdminOrders.tsx
@@ -8,6 +8,8 @@ import { ErrorState } from '@/components/ui/ErrorState';
 import { Pagination } from '@/components/ui/Pagination';
 import { Price } from '@/components/ui/Price';
 import { Skeleton } from '@/components/ui/Skeleton';
+import { Input } from '@/components/ui/Input';
+import { Button } from '@/components/ui/Button';
 import { adminApi } from '@/lib/api/admin';
 import { ApiError } from '@/lib/api/client';
 import type { ListEnvelope, OrderDto, OrderStatus } from '@/lib/types';
@@ -30,6 +32,8 @@ const formatDate = (iso: string): string =>
   });
 
 export function AdminOrders() {
+  const [searchInput, setSearchInput] = useState('');
+  const [search, setSearch] = useState('');
   const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
   const [page, setPage] = useState(1);
   const [state, setState] = useState<ListState>({ status: 'loading' });
@@ -42,6 +46,7 @@ export function AdminOrders() {
       setState({ status: 'loading' });
       try {
         const data = await adminApi.listOrders({
+          search: search || undefined,
           status: statusFilter || undefined,
           page,
           limit: 10,
@@ -61,11 +66,18 @@ export function AdminOrders() {
     return () => {
       cancelled = true;
     };
-  }, [statusFilter, page, reloadKey]);
+  }, [statusFilter, page, reloadKey, search]);
 
   return (
     <div className="space-y-5">
       <h1 className="text-2xl font-semibold tracking-tight text-ink">Orders</h1>
+      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
+        event.preventDefault(); setPage(1); setSearch(searchInput.trim());
+      }}>
+        <Input id="order-search" label="Order number or customer phone" hint="Enter the complete order number or mobile number (+880 supported)." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={40} />
+        <Button type="submit">Search</Button>
+        <Button type="button" variant="secondary" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>Clear</Button>
+      </form>
 
       <div className="flex flex-wrap items-end gap-3">
         <div className="flex flex-col gap-1.5">
@@ -127,6 +139,7 @@ export function AdminOrders() {
                       {order.items.length === 1 ? '' : 's'}
                     </p>
                     <p className="text-xs font-medium text-ink">{order.shippingAddress.phone}</p>
+                    <p className="text-xs text-muted">{order.shippingAddress.fullName}</p>
                   </div>
                   <div className="flex items-center gap-3">
                     <OrderStatusBadge status={order.status} />
diff --git a/client/components/auth/AccountPanel.tsx b/client/components/auth/AccountPanel.tsx
index 4a3f395..8b82293 100644
--- a/client/components/auth/AccountPanel.tsx
+++ b/client/components/auth/AccountPanel.tsx
@@ -2,8 +2,8 @@
 
 import Link from 'next/link';
 import { useAuth } from '@/components/auth/AuthProvider';
-import { EmptyState } from '@/components/ui/EmptyState';
 import { Skeleton } from '@/components/ui/Skeleton';
+import { AccountEditor } from './AccountEditor';
 
 export function AccountPanel() {
   const { user } = useAuth();
@@ -23,7 +23,7 @@ export function AccountPanel() {
 
       <section aria-labelledby="profile-heading" className="rounded-2xl border border-line bg-surface p-5">
         <h2 id="profile-heading" className="text-base font-semibold text-ink">
-          Profile
+          Profile and delivery addresses
         </h2>
         <dl className="mt-3 space-y-2 text-sm">
           <div className="flex flex-wrap gap-2">
@@ -39,40 +39,7 @@ export function AccountPanel() {
             <dd className="text-ink capitalize">{user.role}</dd>
           </div>
         </dl>
-        <p className="mt-4 text-xs text-muted">
-          Profile editing and address management ship in a later release — your addresses added at
-          checkout are saved to this account.
-        </p>
-      </section>
-
-      <section aria-labelledby="addresses-heading" className="rounded-2xl border border-line bg-surface p-5">
-        <h2 id="addresses-heading" className="text-base font-semibold text-ink">
-          Saved addresses
-        </h2>
-        {user.addresses.length === 0 ? (
-          <div className="mt-3">
-            <EmptyState
-              title="No saved addresses yet"
-              description="Addresses you save during checkout will appear here."
-            />
-          </div>
-        ) : (
-          <ul className="mt-3 space-y-3 text-sm">
-            {user.addresses.map((address) => (
-              <li key={address._id} className="rounded-xl border border-line px-3 py-2">
-                <p className="font-medium text-ink">
-                  {address.label ? `${address.label} — ` : ''}
-                  {address.fullName}
-                </p>
-                <p className="text-muted">
-                  {address.line1}
-                  {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.country}
-                  {address.isDefault ? ' · Default' : ''}
-                </p>
-              </li>
-            ))}
-          </ul>
-        )}
+        <AccountEditor />
       </section>
 
       <section aria-labelledby="shortcuts-heading" className="rounded-2xl border border-line bg-surface p-5">
diff --git a/client/components/auth/AuthProvider.tsx b/client/components/auth/AuthProvider.tsx
index 69557e5..558baac 100644
--- a/client/components/auth/AuthProvider.tsx
+++ b/client/components/auth/AuthProvider.tsx
@@ -7,10 +7,11 @@ import {
   useEffect,
   useMemo,
   useState,
+  useRef,
   type ReactNode,
 } from 'react';
 import { authApi } from '@/lib/api/auth';
-import { ApiError } from '@/lib/api/client';
+import { refreshSession, type RefreshResult } from '@/lib/auth/refresh-session';
 import type { LoginPayload, RegisterPayload, User } from '@/lib/types';
 
 export interface AuthContextValue {
@@ -21,7 +22,10 @@ export interface AuthContextValue {
   /** Google sign-in/sign-up with a Google Identity Services credential. */
   loginWithGoogle: (credential: string) => Promise<User>;
   logout: () => Promise<void>;
-  refresh: () => Promise<void>;
+  refresh: () => Promise<RefreshResult<User>>;
+  refreshError: string | null;
+  updateUser: (update: (current: User) => User) => void;
+  invalidateSession: () => void;
 }
 
 const AuthContext = createContext<AuthContextValue | null>(null);
@@ -29,20 +33,28 @@ const AuthContext = createContext<AuthContextValue | null>(null);
 export function AuthProvider({ children }: { children: ReactNode }) {
   const [user, setUser] = useState<User | null>(null);
   const [loading, setLoading] = useState(true);
+  const [refreshError, setRefreshError] = useState<string | null>(null);
+  const refreshRequest = useRef<Promise<RefreshResult<User>> | null>(null);
 
-  const refresh = useCallback(async () => {
-    try {
-      const { user: me } = await authApi.getMe();
-      setUser(me);
-    } catch (error) {
-      // 401 simply means "not logged in" — never surface it as an error.
-      if (!(error instanceof ApiError && error.status === 401)) {
-        // Any other failure also degrades to logged-out state, silently.
-      }
-      setUser(null);
-    } finally {
+  const refresh = useCallback((): Promise<RefreshResult<User>> => {
+    if (refreshRequest.current) return refreshRequest.current;
+    const request = refreshSession(authApi.getMe, setUser).then((result) => {
+      setRefreshError(result.status === 'error' ? 'Could not refresh your account. Please retry.' : null);
+      return result;
+    }).finally(() => {
       setLoading(false);
-    }
+      refreshRequest.current = null;
+    });
+    refreshRequest.current = request;
+    return request;
+  }, []);
+
+  const updateUser = useCallback((update: (current: User) => User) => {
+    setUser((current) => current ? update(current) : current);
+  }, []);
+  const invalidateSession = useCallback(() => {
+    setUser(null);
+    setRefreshError(null);
   }, []);
 
   useEffect(() => {
@@ -56,18 +68,21 @@ export function AuthProvider({ children }: { children: ReactNode }) {
   const login = useCallback(async (payload: LoginPayload): Promise<User> => {
     const { user: loggedIn } = await authApi.login(payload);
     setUser(loggedIn);
+    setRefreshError(null);
     return loggedIn;
   }, []);
 
   const register = useCallback(async (payload: RegisterPayload): Promise<User> => {
     const { user: created } = await authApi.register(payload);
     setUser(created);
+    setRefreshError(null);
     return created;
   }, []);
 
   const loginWithGoogle = useCallback(async (credential: string): Promise<User> => {
     const { user: loggedIn } = await authApi.loginWithGoogle({ credential });
     setUser(loggedIn);
+    setRefreshError(null);
     return loggedIn;
   }, []);
 
@@ -76,12 +91,13 @@ export function AuthProvider({ children }: { children: ReactNode }) {
       await authApi.logout();
     } finally {
       setUser(null);
+      setRefreshError(null);
     }
   }, []);
 
   const value = useMemo<AuthContextValue>(
-    () => ({ user, loading, login, register, loginWithGoogle, logout, refresh }),
-    [user, loading, login, register, loginWithGoogle, logout, refresh],
+    () => ({ user, loading, login, register, loginWithGoogle, logout, refresh, refreshError, updateUser, invalidateSession }),
+    [user, loading, login, register, loginWithGoogle, logout, refresh, refreshError, updateUser, invalidateSession],
   );
 
   return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
diff --git a/client/components/auth/RouteGuard.tsx b/client/components/auth/RouteGuard.tsx
index 019239d..ac34b48 100644
--- a/client/components/auth/RouteGuard.tsx
+++ b/client/components/auth/RouteGuard.tsx
@@ -4,21 +4,22 @@ import { useEffect, type ReactNode } from 'react';
 import { usePathname, useRouter } from 'next/navigation';
 import { useAuth } from '@/components/auth/AuthProvider';
 import { Spinner } from '@/components/ui/Spinner';
+import { ErrorState } from '@/components/ui/ErrorState';
 
 /**
  * Client-side convenience guard only — the Express API is the real authority
  * and rejects unauthorized requests regardless of what the UI shows.
  */
 export function RequireAuth({ children }: { children: ReactNode }) {
-  const { user, loading } = useAuth();
+  const { user, loading, refreshError, refresh } = useAuth();
   const router = useRouter();
   const pathname = usePathname();
 
   useEffect(() => {
-    if (!loading && user === null) {
+    if (!loading && user === null && !refreshError) {
       router.replace(`/login?next=${encodeURIComponent(pathname)}`);
     }
-  }, [loading, user, router, pathname]);
+  }, [loading, user, router, pathname, refreshError]);
 
   if (loading) {
     return (
@@ -28,11 +29,12 @@ export function RequireAuth({ children }: { children: ReactNode }) {
     );
   }
 
+  if (!user && refreshError) return <ErrorState title="Could not load your account" description={refreshError} onRetry={() => { void refresh(); }} />;
   return user ? <>{children}</> : null;
 }
 
 export function RequireAdmin({ children }: { children: ReactNode }) {
-  const { user, loading } = useAuth();
+  const { user, loading, refreshError, refresh } = useAuth();
   const router = useRouter();
   const pathname = usePathname();
 
@@ -40,14 +42,14 @@ export function RequireAdmin({ children }: { children: ReactNode }) {
     if (loading) {
       return;
     }
-    if (user === null) {
+    if (user === null && !refreshError) {
       router.replace(`/login?next=${encodeURIComponent(pathname)}`);
       return;
     }
-    if (user.role !== 'admin') {
+    if (user && user.role !== 'admin') {
       router.replace('/');
     }
-  }, [loading, user, router, pathname]);
+  }, [loading, user, router, pathname, refreshError]);
 
   if (loading) {
     return (
@@ -57,5 +59,6 @@ export function RequireAdmin({ children }: { children: ReactNode }) {
     );
   }
 
+  if (!user && refreshError) return <ErrorState title="Could not load your account" description={refreshError} onRetry={() => { void refresh(); }} />;
   return user?.role === 'admin' ? <>{children}</> : null;
 }
diff --git a/client/components/layout/Footer.tsx b/client/components/layout/Footer.tsx
index 079a475..1bb5b56 100644
--- a/client/components/layout/Footer.tsx
+++ b/client/components/layout/Footer.tsx
@@ -32,7 +32,7 @@ export function Footer() {
           <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
             {site.footer.description}
           </p>
-          <ul className="mt-2 flex items-center gap-2 md:mt-3">
+          {site.socials.length > 0 ? <ul className="mt-2 flex items-center gap-2 md:mt-3">
             {site.socials.map((social) => {
               const Icon = socialIcons[social.label];
               return (
@@ -47,7 +47,7 @@ export function Footer() {
                 </li>
               );
             })}
-          </ul>
+          </ul> : null}
         </div>
 
         {/* Link columns — two per row on phones so the footer stays short.
diff --git a/client/components/orders/OrderDetailClient.tsx b/client/components/orders/OrderDetailClient.tsx
index 662b7c4..f82663f 100644
--- a/client/components/orders/OrderDetailClient.tsx
+++ b/client/components/orders/OrderDetailClient.tsx
@@ -137,7 +137,7 @@ export function OrderDetailClient({ orderId }: { orderId: string }) {
 
   const { order } = state;
   const address = order.shippingAddress;
-  const canCancel = order.status === 'pending';
+  const canCancel = order.status === 'pending' || order.status === 'processing';
 
   return (
     <div className="space-y-6">
@@ -324,7 +324,7 @@ export function OrderDetailClient({ orderId }: { orderId: string }) {
           ) : (
             <div className="mt-3">
               <p className="text-sm text-muted">
-                Changed your mind? Pending orders can be cancelled and stock will be restored.
+                Changed your mind? Pending or processing orders can be cancelled before shipment.
               </p>
               <Button variant="secondary" className="mt-3" onClick={() => setConfirming(true)}>
                 Cancel order
diff --git a/client/config/site.ts b/client/config/site.ts
index 1c1a4a6..cc1b60b 100644
--- a/client/config/site.ts
+++ b/client/config/site.ts
@@ -32,13 +32,13 @@ export const site = {
   name: 'Abstract Lifestyle',
   tagline: 'Clothing & everyday lifestyle',
   description:
-    'Clothing and everyday lifestyle essentials with Cash on Delivery, flat-fee delivery and easy exchange.',
+    'Clothing and everyday lifestyle essentials with Cash on Delivery and flat-fee delivery.',
 
   /** Announcement bar — exactly three short lines, one per icon. */
   announcement: [
     'Cash on Delivery on every order',
     'Flat delivery fee on every order',
-    'Easy exchange on every purchase',
+    'Manage your orders from your account',
   ],
 
   /** Hero copy (used by the home page). */
@@ -47,7 +47,7 @@ export const site = {
     titleLine1: 'Everyday style,',
     titleLine2: 'made simple.',
     subtitle:
-      'Clothing and lifestyle essentials with Cash on Delivery, flat-fee delivery and easy exchange.',
+      'Clothing and lifestyle essentials with Cash on Delivery and flat-fee delivery.',
     primaryCta: { label: 'Shop Now', href: '/products' },
     secondaryCta: { label: 'Explore Collections', href: '/products?sort=newest' },
   },
@@ -55,8 +55,8 @@ export const site = {
   /** Promo banner copy (home page). */
   promo: {
     pill: 'JUST ARRIVED',
-    title: 'New styles every week',
-    text: 'Fresh picks are added to the catalog on a regular basis — browse the latest arrivals.',
+    title: 'Explore the collection',
+    text: 'Browse clothing and everyday lifestyle products.',
     cta: { label: 'Shop New Arrivals', href: '/products?sort=newest' },
     badge: 'New in',
   },
@@ -64,7 +64,7 @@ export const site = {
   /** Trust strip + hero features — every claim here is true for this store. */
   trust: [
     { icon: 'cod', title: 'Cash on Delivery', text: 'Pay in cash when your order arrives.' },
-    { icon: 'exchange', title: 'Easy Exchange', text: 'Simple exchange on eligible items.' },
+    { icon: 'exchange', title: 'Order history', text: 'View orders from your account.' },
     { icon: 'shield', title: 'Secure Checkout', text: 'Your details stay protected.' },
     { icon: 'support', title: 'Support', text: 'We are happy to help.' },
   ] as TrustItem[],
@@ -89,7 +89,7 @@ export const site = {
     whatHappensNext: [
       'We call you on the phone number you gave us to confirm the order before dispatch.',
       'You pay cash to the delivery person when the order arrives.',
-      'You can cancel this order from this page while it is still pending.',
+      'You can cancel this order while it is pending or processing, before shipment.',
     ],
   },
 
@@ -119,7 +119,7 @@ export const site = {
   footer: {
     /** Two-line brand blurb. */
     description:
-      'Clothing and everyday lifestyle products, kept simple. Cash on Delivery, flat-fee delivery and easy exchange on every order.',
+      'Clothing and everyday lifestyle products, kept simple. Cash on Delivery and flat-fee delivery.',
     columns: [
       {
         title: 'Shop',
@@ -163,10 +163,10 @@ export const site = {
   productPage: {
     // OWNER: confirm — these statements must match the store's real policies before launch.
     shippingAndReturns:
-      'Cash on Delivery on every order. Flat-fee delivery nationwide. Easy exchange on eligible items.',
+      'Cash on Delivery. The delivery fee is shown at checkout.',
     trust: [
       { title: 'Cash on Delivery', text: 'Pay in cash when your order arrives.' },
-      { title: 'Easy Exchange', text: 'Simple exchange on eligible items.' },
+      { title: 'Order history', text: 'View orders from your account.' },
       { title: 'Secure Checkout', text: 'Your details stay protected.' },
     ],
     relatedTitle: 'You may also like',
@@ -174,15 +174,11 @@ export const site = {
   },
 
   // OWNER: confirm — replace '#' with the real profile URLs (or remove unused ones).
-  socials: [
-    { label: 'Facebook', href: '#' },
-    { label: 'Instagram', href: '#' },
-    { label: 'X', href: '#' },
-  ] as SocialLink[],
+  socials: [] as SocialLink[],
 
   // OWNER: confirm — real support email and hours before launch.
   contact: {
-    email: 'hello@example.com',
-    hours: 'Saturday–Thursday, 10:00–18:00',
+    email: '',
+    hours: '',
   },
 };
diff --git a/client/lib/api/admin.ts b/client/lib/api/admin.ts
index 2784ad5..33c5e44 100644
--- a/client/lib/api/admin.ts
+++ b/client/lib/api/admin.ts
@@ -26,6 +26,7 @@ export interface AdminProductQuery {
 }
 
 export interface AdminOrderQuery {
+  search?: string;
   status?: OrderStatus;
   page?: number;
   limit?: number;
diff --git a/client/lib/api/user.ts b/client/lib/api/user.ts
index e1deedc..40dc43f 100644
--- a/client/lib/api/user.ts
+++ b/client/lib/api/user.ts
@@ -1,8 +1,11 @@
-import type { AddressListResponse, AddressPayload, AddressResponse } from '../types';
+import type { AddressListResponse, AddressPayload, AddressResponse, UserResponse } from '../types';
 import { apiFetch } from './client';
 
 export const userApi = {
+  updateProfile: (name: string) => apiFetch<UserResponse>('/users/me', { method: 'PATCH', body: { name } }),
+  patchAddress: (id: string, payload: Partial<AddressPayload>) => apiFetch<AddressResponse>(`/users/me/addresses/${id}`, { method: 'PATCH', body: payload }),
+  deleteAddress: (id: string) => apiFetch<void>(`/users/me/addresses/${id}`, { method: 'DELETE' }),
   getAddresses: () => apiFetch<AddressListResponse>('/users/me/addresses'),
   createAddress: (payload: AddressPayload) =>
     apiFetch<AddressResponse>('/users/me/addresses', { method: 'POST', body: payload }),
-};
\ No newline at end of file
+};
diff --git a/client/lib/validation/address.ts b/client/lib/validation/address.ts
index 0afbf9c..77540f1 100644
--- a/client/lib/validation/address.ts
+++ b/client/lib/validation/address.ts
@@ -1,5 +1,5 @@
 import type { AddressPayload } from '@/lib/types';
-import { BD_MOBILE_ERROR, normalizeBdMobile } from '@/lib/utils/phone';
+import { BD_MOBILE_ERROR, normalizeBdMobile } from '../utils/phone.ts';
 import type { FieldErrors } from './auth';
 
 /**
@@ -8,6 +8,15 @@ import type { FieldErrors } from './auth';
  */
 export type AddressFormValues = AddressPayload;
 
+export const optionalAddressFields = [
+  { name: 'label', label: 'Address label (optional)', maxLength: 30 },
+  { name: 'line2', label: 'Address line 2 (optional)', maxLength: 200 },
+  { name: 'city', label: 'City (optional)', maxLength: 100 },
+  { name: 'state', label: 'State or region (optional)', maxLength: 100 },
+  { name: 'postalCode', label: 'Postal code (optional)', maxLength: 20 },
+  { name: 'country', label: 'Country (optional)', maxLength: 100 },
+] as const;
+
 export const validateAddress = (values: AddressFormValues): FieldErrors<AddressFormValues> => {
   const errors: FieldErrors<AddressFormValues> = {};
   const text = (value: string | undefined): string => (value ?? '').trim();
@@ -81,3 +90,13 @@ export const cleanAddressPayload = (values: AddressFormValues): AddressPayload =
   optional('country');
   return payload;
 };
+
+/** PATCH: omitted optional fields stay omitted; explicit empty strings clear them. */
+export const addressUpdatePayload = (values: AddressFormValues): AddressPayload => {
+  const payload = cleanAddressPayload(values);
+  for (const { name } of optionalAddressFields) {
+    if (values[name] !== undefined) payload[name] = values[name].trim();
+  }
+  if (values.isDefault !== undefined) payload.isDefault = values.isDefault;
+  return payload;
+};
diff --git a/client/package.json b/client/package.json
index c07e2a9..485eb38 100644
--- a/client/package.json
+++ b/client/package.json
@@ -8,7 +8,8 @@
     "start": "next start",
     "lint": "eslint",
     "type-check": "next typegen && tsc --noEmit",
-    "test": "node --test lib/__tests__/site-url.test.ts"
+    "test": "node --test lib/__tests__/site-url.test.ts lib/__tests__/public-content.test.ts lib/__tests__/account-refresh.test.ts lib/__tests__/address-update.test.ts",
+    "test:browser": "node --test tests/account.browser.mjs"
   },
   "dependencies": {
     "next": "16.4.5",
diff --git a/server/src/models/order.model.ts b/server/src/models/order.model.ts
index a72a98d..7eb019e 100644
--- a/server/src/models/order.model.ts
+++ b/server/src/models/order.model.ts
@@ -126,5 +126,7 @@ orderSchema.index({ orderNumber: 1 }, { unique: true });
 orderSchema.index({ checkoutId: 1 }, { unique: true, sparse: true });
 orderSchema.index({ user: 1, createdAt: -1 });
 orderSchema.index({ status: 1, createdAt: -1 });
+orderSchema.index({ 'shippingAddress.phone': 1, createdAt: -1, _id: -1 });
+orderSchema.index({ 'shippingAddress.phone': 1, status: 1, createdAt: -1, _id: -1 });
 
 export const OrderModel = model<Order>('Order', orderSchema);
diff --git a/server/src/schemas/admin.schema.ts b/server/src/schemas/admin.schema.ts
index ec4ecb4..8641516 100644
--- a/server/src/schemas/admin.schema.ts
+++ b/server/src/schemas/admin.schema.ts
@@ -1,5 +1,6 @@
 import { z } from 'zod';
 import { objectIdSchema } from './common.schema.js';
+import { normalizeBdMobile } from '../utils/phone.js';
 
 export const adminIdParamsSchema = z.object({ id: objectIdSchema });
 
@@ -21,6 +22,10 @@ export const adminProductQuerySchema = z.object({
 });
 
 export const adminOrderQuerySchema = z.object({
+  search: z.string().trim().max(40).refine(
+    (value) => normalizeBdMobile(value) !== null || /^AL-\d{8}-[A-Z2-9]{4}$/i.test(value),
+    'Enter a complete order number or Bangladeshi mobile number.',
+  ).optional(),
   status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
   page: z.coerce.number().int().min(1).default(1),
   limit: z.coerce.number().int().min(1).max(50).default(12),
diff --git a/server/src/scripts/seed.ts b/server/src/scripts/seed.ts
index f148dd8..12fcefa 100644
--- a/server/src/scripts/seed.ts
+++ b/server/src/scripts/seed.ts
@@ -7,6 +7,8 @@ import { ProductModel } from '../models/product.model.js';
 import { UserModel } from '../models/user.model.js';
 import { VariantModel } from '../models/variant.model.js';
 import { slugify } from '../utils/slug.js';
+import { BCRYPT_COST } from '../config/password.js';
+import { pathToFileURL } from 'node:url';
 
 interface CategorySeed {
   name: string;
@@ -49,13 +51,13 @@ const upsertProduct = async (seed: ProductSeed): Promise<Types.ObjectId> => {
   const doc = await ProductModel.findOneAndUpdate(
     { slug },
     {
-      $set: {
+      $setOnInsert: {
         name: seed.name,
         slug,
         description: seed.description,
         category: seed.categoryId,
         basePrice: seed.basePrice,
-        status: 'active',
+        status: 'draft',
       },
     },
     { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
@@ -64,6 +66,12 @@ const upsertProduct = async (seed: ProductSeed): Promise<Types.ObjectId> => {
   if (!doc) {
     throw new Error(`Failed to upsert product: ${seed.name}`);
   }
+  // Repair only legacy imageless demo publications. The image predicate is
+  // rechecked by MongoDB so an operator adding legitimate images is preserved.
+  await ProductModel.updateOne(
+    { _id: doc._id, status: 'active', $or: [{ images: { $size: 0 } }, { images: { $exists: false } }] },
+    { $set: { status: 'draft' } },
+  ).exec();
   return doc._id;
 };
 
@@ -71,7 +79,7 @@ const upsertVariant = async (seed: VariantSeed): Promise<void> => {
   await VariantModel.findOneAndUpdate(
     { sku: seed.sku },
     {
-      $set: {
+      $setOnInsert: {
         product: seed.productId,
         sku: seed.sku,
         size: seed.size,
@@ -85,17 +93,15 @@ const upsertVariant = async (seed: VariantSeed): Promise<void> => {
   ).exec();
 };
 
-const seed = async (): Promise<void> => {
+export const seedData = async (adminOnly = false): Promise<void> => {
   // `--admin-only` seeds the admin user + category trees and skips the demo
   // products/variants (use this for production databases).
-  const adminOnly = process.argv.includes('--admin-only');
-  await connectDB({ requireTransactions: false });
 
   // 1. Admin user (credentials from env — see .env.example)
-  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
+  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, BCRYPT_COST);
   await UserModel.findOneAndUpdate(
     { email: env.ADMIN_EMAIL },
-    { $set: { email: env.ADMIN_EMAIL, passwordHash, name: 'Store Admin', role: 'admin' } },
+    { $setOnInsert: { email: env.ADMIN_EMAIL, passwordHash, name: 'Store Admin', role: 'admin' } },
     { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
   ).exec();
 
@@ -175,10 +181,18 @@ const seed = async (): Promise<void> => {
     console.log(`  variants: ${variants}`);
   }
 
-  await disconnectDB();
 };
 
-seed().catch((error: unknown) => {
-  console.error('Seed failed:', error);
-  process.exit(1);
-});
+if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
+  void (async () => {
+    try {
+      await connectDB({ requireTransactions: false });
+      await seedData(process.argv.includes('--admin-only'));
+    } catch {
+      console.error('Seed failed. Check the configured database and credentials.');
+      process.exitCode = 1;
+    } finally {
+      await disconnectDB();
+    }
+  })();
+}
diff --git a/server/src/services/admin-order.service.ts b/server/src/services/admin-order.service.ts
index 3ffadf5..e839041 100644
--- a/server/src/services/admin-order.service.ts
+++ b/server/src/services/admin-order.service.ts
@@ -5,6 +5,7 @@ import { VariantModel } from '../models/variant.model.js';
 import { UserModel, type UserDocument } from '../models/user.model.js';
 import type { AdminOrderQuery, AdminOrderStatusUpdateInput } from '../schemas/admin.schema.js';
 import { toOrderDto, type OrderDto, type OrderListResult } from './order.service.js';
+import { normalizeBdMobile } from '../utils/phone.js';
 
 const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
   pending: ['processing', 'cancelled'],
@@ -15,7 +16,14 @@ const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
 };
 
 export const adminListOrders = async (query: AdminOrderQuery): Promise<OrderListResult> => {
-  const filter = query.status ? { status: query.status } : {};
+  // Exact indexed lookup only: never interpolate user input into a regex.
+  const phone = query.search ? normalizeBdMobile(query.search) : null;
+  const filter = {
+    ...(query.status ? { status: query.status } : {}),
+    ...(query.search ? phone
+      ? { 'shippingAddress.phone': phone }
+      : { orderNumber: query.search.toUpperCase() } : {}),
+  };
 
   const [orders, total] = await Promise.all([
     OrderModel.find(filter)
diff --git a/server/src/services/auth.service.ts b/server/src/services/auth.service.ts
index 39912c0..d282fe0 100644
--- a/server/src/services/auth.service.ts
+++ b/server/src/services/auth.service.ts
@@ -4,7 +4,7 @@ import { UserModel, type UserDocument } from '../models/user.model.js';
 import type { LoginInput, RegisterInput } from '../schemas/user.schema.js';
 import { verifyGoogleCredential } from './google-auth.service.js';
 
-const BCRYPT_COST = 12;
+import { BCRYPT_COST } from '../config/password.js';
 
 // Compared against when the email does not exist, so login timing looks the same.
 const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-placeholder', BCRYPT_COST);
diff --git a/server/src/services/order.service.ts b/server/src/services/order.service.ts
index 946be1c..4eb0f70 100644
--- a/server/src/services/order.service.ts
+++ b/server/src/services/order.service.ts
@@ -421,7 +421,7 @@ export const getOrder = async (user: UserDocument, orderId: string): Promise<Ord
 };
 
 /**
- * Customer cancellation: only while `pending`. The status change, the
+ * Customer cancellation: while pending or processing. The status change, the
  * `stockRestored` flag and the stock restoration all happen in ONE
  * transaction, so a failed restore can never leave an order cancelled
  * without its stock back (and vice versa).
@@ -433,7 +433,7 @@ export const cancelOrder = async (user: UserDocument, orderId: string): Promise<
   try {
     await session.withTransaction(async () => {
       const updated = await OrderModel.findOneAndUpdate(
-        { _id: orderId, user: user._id, status: 'pending', stockRestored: { $ne: true } },
+        { _id: orderId, user: user._id, status: { $in: ['pending', 'processing'] }, stockRestored: { $ne: true } },
         {
           $set: { status: 'cancelled', stockRestored: true },
           $push: { statusHistory: { status: 'cancelled', at: new Date() } },
@@ -448,7 +448,7 @@ export const cancelOrder = async (user: UserDocument, orderId: string): Promise<
         if (!exists) {
           throw new AppError(404, 'NOT_FOUND', 'Order not found');
         }
-        throw new AppError(409, 'CONFLICT', 'Order cannot be cancelled');
+        throw new AppError(409, 'CONFLICT', 'Only pending or processing orders can be cancelled. This order may already have shipped or been cancelled.');
       }
 
       // Only the winner of the guarded transition above restores stock. A
diff --git a/server/src/services/user.service.ts b/server/src/services/user.service.ts
index e88da3b..1858381 100644
--- a/server/src/services/user.service.ts
+++ b/server/src/services/user.service.ts
@@ -1,4 +1,6 @@
 import { AppError } from '../middleware/error-handler.js';
+import mongoose from 'mongoose';
+import { UserModel } from '../models/user.model.js';
 import type { Address, UserDocument } from '../models/user.model.js';
 import type { AddressInput, AddressUpdateInput, UpdateProfileInput } from '../schemas/user.schema.js';
 
@@ -23,16 +25,31 @@ export const updateProfile = async (
   user: UserDocument,
   input: UpdateProfileInput,
 ): Promise<UserDocument> => {
-  if (input.name !== undefined) {
-    user.name = input.name;
-  }
-  await user.save();
-  return user;
+  const updated = await UserModel.findByIdAndUpdate(user._id, { $set: { name: input.name } }, { returnDocument: 'after', runValidators: true }).exec();
+  if (!updated) throw new AppError(404, 'NOT_FOUND', 'Account not found');
+  return updated;
+};
+
+/** Reload within a transaction so concurrent address edits retry on fresh data. */
+const mutateAddresses = async <T>(user: UserDocument, mutate: (fresh: UserDocument) => Promise<T>): Promise<T> => {
+  const session = await mongoose.startSession();
+  try {
+    return await session.withTransaction(async () => {
+      const fresh = await UserModel.findById(user._id).session(session).exec();
+      if (!fresh) throw new AppError(404, 'NOT_FOUND', 'Account not found');
+      const result = await mutate(fresh);
+      const selected = fresh.addresses.find((address) => address.isDefault) ?? fresh.addresses[0];
+      for (const address of fresh.addresses) address.isDefault = address === selected;
+      await fresh.save({ session });
+      return result;
+    });
+  } finally { await session.endSession(); }
 };
 
 export const listAddresses = (user: UserDocument): Address[] => user.addresses;
 
 export const addAddress = async (user: UserDocument, input: AddressInput): Promise<Address> => {
+  return mutateAddresses(user, async (user) => {
   if (input.isDefault) {
     for (const existing of user.addresses) {
       existing.isDefault = false;
@@ -40,13 +57,13 @@ export const addAddress = async (user: UserDocument, input: AddressInput): Promi
   }
 
   user.addresses.push(input);
-  await user.save();
 
   const created = user.addresses[user.addresses.length - 1];
   if (!created) {
     throw new AppError(500, 'SERVER_ERROR', 'Failed to save address');
   }
   return created;
+  });
 };
 
 export const updateAddress = async (
@@ -54,6 +71,7 @@ export const updateAddress = async (
   addressId: string,
   input: AddressUpdateInput,
 ): Promise<Address> => {
+  return mutateAddresses(user, async (user) => {
   const address = user.addresses.find(
     (existing) => existing._id !== undefined && existing._id.toString() === addressId,
   );
@@ -80,11 +98,12 @@ export const updateAddress = async (
   if (input.country !== undefined) address.country = input.country;
   if (input.isDefault !== undefined) address.isDefault = input.isDefault;
 
-  await user.save();
   return address;
+  });
 };
 
 export const deleteAddress = async (user: UserDocument, addressId: string): Promise<void> => {
+  await mutateAddresses(user, async (user) => {
   const exists = user.addresses.some(
     (existing) => existing._id !== undefined && existing._id.toString() === addressId,
   );
@@ -95,5 +114,5 @@ export const deleteAddress = async (user: UserDocument, addressId: string): Prom
   user.addresses = user.addresses.filter(
     (existing) => existing._id?.toString() !== addressId,
   );
-  await user.save();
+  });
 };
diff --git a/server/test/order-integrity.test.ts b/server/test/order-integrity.test.ts
index 2eb9711..1ae2d4f 100644
--- a/server/test/order-integrity.test.ts
+++ b/server/test/order-integrity.test.ts
@@ -25,6 +25,13 @@ import { addItem, clearCart, getCart, mergeGuestItems, removeItem, updateItem }
 import { cancelOrder, createOrder } from '../src/services/order.service.js';
 import { AppError } from '../src/middleware/error-handler.js';
 import { CHECKOUT_CLAIM_STALE_MS } from '../src/config/checkout.js';
+import { addAddress, updateAddress, deleteAddress, updateProfile } from '../src/services/user.service.js';
+import { adminListOrders } from '../src/services/admin-order.service.js';
+import { adminOrderQuerySchema } from '../src/schemas/admin.schema.js';
+import { addressSchema, addressUpdateSchema } from '../src/schemas/user.schema.js';
+import { seedData } from '../src/scripts/seed.js';
+import bcrypt from 'bcryptjs';
+import { env } from '../src/config/env.js';
 
 let sequence = 0;
 const unique = (prefix: string): string => {
@@ -148,6 +155,125 @@ describe('Phase 0 — order integrity (A5, B1, B2, B3)', () => {
   });
 
   // ---- A5 -----------------------------------------------------------------
+  describe('Phase 1 business functionality', () => {
+    it('edits and explicitly clears all optional address values while omitted fields and order snapshots survive', async () => {
+      const fixture = await makeFixture();
+      const fields = ['label', 'line2', 'city', 'state', 'postalCode', 'country'] as const;
+      const input = addressSchema.parse({ fullName: 'Customer', phone: '01712345678', line1: 'Dhaka',
+        label: 'Home', line2: 'Flat 4', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' });
+      const address = await addAddress(fixture.user, input); assert.ok(address._id);
+      await addItem(fixture.user._id, fixture.variant.toString(), 1);
+      const order = await createOrder(fixture.user, { checkoutId: randomUUID(), paymentMethod: 'cod', shippingAddress: input });
+      const snapshot = JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress);
+      await updateAddress(fixture.user, address._id.toString(), addressUpdateSchema.parse({ line1: 'New street' }));
+      let stored = (await UserModel.findById(fixture.user._id))?.addresses[0];
+      for (const field of fields) assert.equal(stored?.[field], input[field], 'omitted values are preserved');
+      const edits = Object.fromEntries(fields.map((field) => [field, `New ${field}`]));
+      await updateAddress(fixture.user, address._id.toString(), addressUpdateSchema.parse(edits));
+      stored = (await UserModel.findById(fixture.user._id))?.addresses[0];
+      for (const field of fields) assert.equal(stored?.[field], `New ${field}`);
+      const cleared = Object.fromEntries(fields.map((field) => [field, '   ']));
+      await updateAddress(fixture.user, address._id.toString(), addressUpdateSchema.parse(cleared));
+      stored = (await UserModel.findById(fixture.user._id))?.addresses[0];
+      for (const field of fields) assert.equal(stored?.[field], '', 'explicit clears persist in MongoDB');
+      assert.ok(stored?.isDefault);
+      assert.equal(JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress), snapshot);
+      assert.throws(() => addressUpdateSchema.parse({ line1: '' }));
+      assert.throws(() => addressUpdateSchema.parse({ label: 'x'.repeat(31) }));
+    });
+    for (const status of ['pending', 'processing', 'shipped', 'cancelled'] as const) {
+      it(`customer cancellation from ${status}`, async () => {
+        const fixture = await makeFixture({ stock: 5 });
+        await addItem(fixture.user._id, fixture.variant.toString(), 1);
+        const order = await placeOrder(fixture.user);
+        if (status !== 'pending') await OrderModel.updateOne({ _id: order.id }, { $set: { status } });
+        if (status === 'pending' || status === 'processing') {
+          await deleteVariant(fixture.variant.toString());
+          await cancelOrder(fixture.user, order.id);
+          assert.equal(await stockOf(fixture.variant), 5);
+          await assert.rejects(cancelOrder(fixture.user, order.id));
+        } else {
+          await assert.rejects(cancelOrder(fixture.user, order.id), (error: unknown) => error instanceof AppError && error.statusCode === 409);
+          assert.equal(await stockOf(fixture.variant), 4);
+        }
+      });
+    }
+    it('serializes customer cancellation against shipment and administrative cancellation', async () => {
+      for (const target of ['shipped', 'cancelled'] as const) {
+        const fixture = await makeFixture({ stock: 5 });
+        await addItem(fixture.user._id, fixture.variant.toString(), 1);
+        const order = await placeOrder(fixture.user);
+        await OrderModel.updateOne({ _id: order.id }, { $set: { status: 'processing' } });
+        await Promise.allSettled([cancelOrder(fixture.user, order.id), adminUpdateOrderStatus(fixture.user, order.id, { status: target })]);
+        const stored = await OrderModel.findById(order.id);
+        assert.ok(stored);
+        assert.ok(stored.status === 'cancelled' || stored.status === 'shipped');
+        assert.equal(stored.stockRestored, stored.status === 'cancelled');
+        assert.equal(await stockOf(fixture.variant), stored.status === 'cancelled' ? 5 : 4);
+      }
+    });
+    it('serializes address/default changes, rejects foreign ids and preserves order snapshots', async () => {
+      const fixture = await makeFixture();
+      await addItem(fixture.user._id, fixture.variant.toString(), 1);
+      const order = await placeOrder(fixture.user);
+      const original = JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress);
+      const input = addressSchema.parse({ fullName: 'Customer', phone: '+8801712345678', line1: 'Dhaka', isDefault: true });
+      const [first, second] = await Promise.all([addAddress(fixture.user, input), addAddress(fixture.user, input)]);
+      assert.ok(first._id && second._id);
+      await Promise.all([updateAddress(fixture.user, first._id.toString(), { isDefault: true }), updateAddress(fixture.user, second._id.toString(), { isDefault: true }), updateProfile(fixture.user, { name: 'New name' })]);
+      let stored = await UserModel.findById(fixture.user._id);
+      assert.equal(stored?.addresses.length, 2);
+      assert.equal(stored?.addresses.filter((a) => a.isDefault).length, 1);
+      assert.equal(stored?.name, 'New name');
+      const other = await makeFixture();
+      await assert.rejects(updateAddress(other.user, first._id.toString(), { line1: 'Wrong owner' }), (error: unknown) => error instanceof AppError && error.statusCode === 404);
+      const defaultId = stored?.addresses.find((a) => a.isDefault)?._id;
+      assert.ok(defaultId);
+      await deleteAddress(fixture.user, defaultId.toString());
+      stored = await UserModel.findById(fixture.user._id);
+      assert.equal(stored?.addresses.length, 1);
+      assert.equal(stored?.addresses[0]?.isDefault, true);
+      assert.equal(JSON.stringify((await OrderModel.findById(order.id))?.shippingAddress), original);
+    });
+    it('searches normalized phones and order numbers with status pagination and indexed plans', async () => {
+      const fixture = await makeFixture();
+      for (let i = 0; i < 3; i++) { await addItem(fixture.user._id, fixture.variant.toString(), 1); await placeOrder(fixture.user); }
+      const phone = '01700000000';
+      const page = await adminListOrders(adminOrderQuerySchema.parse({ search: '+8801700000000', status: 'pending', page: 2, limit: 1 }));
+      assert.equal(page.total, 3); assert.equal(page.items.length, 1); assert.equal(page.totalPages, 3);
+      const number = page.items[0]?.orderNumber;
+      assert.ok(number);
+      assert.equal((await adminListOrders(adminOrderQuerySchema.parse({ search: number.toLowerCase() }))).total, 1);
+      assert.equal((await adminListOrders(adminOrderQuerySchema.parse({ search: phone, status: 'shipped' }))).total, 0);
+      assert.throws(() => adminOrderQuerySchema.parse({ search: '.*' }));
+      const plan = await OrderModel.collection.find({ 'shippingAddress.phone': phone, status: 'pending' }).sort({ createdAt: -1, _id: -1 }).limit(1).explain('executionStats');
+      assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /IXSCAN/);
+      assert.ok(plan.executionStats.totalDocsExamined <= 1);
+    });
+    it('seeds cost-12 credentials and draft demos without resetting repeated-seed stock or credentials', async () => {
+      await seedData();
+      const admin = await UserModel.findOne({ email: env.ADMIN_EMAIL });
+      assert.ok(admin?.passwordHash);
+      assert.equal(bcrypt.getRounds(admin.passwordHash), 12);
+      assert.equal(await bcrypt.compare(env.ADMIN_PASSWORD, admin.passwordHash), true);
+      assert.equal(await ProductModel.countDocuments({ status: 'active' }), 0);
+      assert.equal(await ProductModel.countDocuments({ status: 'draft' }), 4);
+      const demos = await ProductModel.find().sort({ _id: 1 });
+      const invalid = demos[0]; const legitimate = demos[1];
+      assert.ok(invalid && legitimate);
+      await ProductModel.updateOne({ _id: invalid._id }, { $set: { status: 'active' } });
+      await ProductModel.updateOne({ _id: legitimate._id }, { $set: { status: 'active', images: ['https://images.example.test/fixture.jpg'] } });
+      const variant = await VariantModel.findOne(); assert.ok(variant);
+      await VariantModel.updateOne({ _id: variant._id }, { $set: { stock: 2 } });
+      const counts = [await UserModel.countDocuments(), await ProductModel.countDocuments(), await VariantModel.countDocuments()];
+      await seedData();
+      assert.equal((await ProductModel.findById(invalid._id))?.status, 'draft');
+      assert.equal((await ProductModel.findById(legitimate._id))?.status, 'active');
+      assert.deepEqual([await UserModel.countDocuments(), await ProductModel.countDocuments(), await VariantModel.countDocuments()], counts);
+      assert.equal((await UserModel.findById(admin._id))?.passwordHash, admin.passwordHash);
+      assert.equal(await stockOf(variant._id), 2);
+    });
+  });
   describe('A5 — variant deletion vs. order history', () => {
     it('archives a variant referenced by an order and restores its stock on cancel', async () => {
       const fixture = await makeFixture({ stock: 10 });
@@ -884,6 +1010,30 @@ describe('Phase 0 — order integrity (A5, B1, B2, B3)', () => {
       assert.equal(await OrderModel.countDocuments(), 0);
       assert.equal(await stockOf(fixture.variant), 10);
     });
+    it('protects profile/address endpoints and admin search from unauthenticated or non-admin access', async () => {
+      const fixture = await makeFixture();
+      assert.equal((await request(null, '/users/me', 'PATCH', { name: 'New' })).status, 401);
+      assert.equal((await request(fixture.user, '/users/me', 'PATCH', { name: '' })).status, 400);
+      assert.equal((await request(fixture.user, '/users/me', 'PATCH', { name: 'New' })).status, 200);
+      assert.equal((await request(fixture.user, '/users/me/addresses', 'POST', { fullName: 'Customer', phone: 'invalid', line1: 'Dhaka' })).status, 400);
+      const created = await request(fixture.user, '/users/me/addresses', 'POST', { fullName: 'Customer', phone: '+8801712345678', line1: 'Dhaka', isDefault: true });
+      assert.equal(created.status, 201);
+      const address = (await created.json() as { address: { _id: string } }).address;
+      const other = await makeFixture();
+      assert.equal((await request(other.user, `/users/me/addresses/${address._id}`, 'PATCH', { line1: 'Wrong owner' })).status, 404);
+      assert.equal((await request(other.user, `/users/me/addresses/${address._id}`, 'DELETE')).status, 404);
+      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'PATCH', { line1: 'Updated' })).status, 200);
+      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'PATCH', { label: 'Home', line2: 'Flat 4', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh' })).status, 200);
+      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'PATCH', { label: '', line2: '', city: '', state: '', postalCode: '', country: '' })).status, 200);
+      const clearedAddress = (await UserModel.findById(fixture.user._id))?.addresses.find((item) => item._id?.toString() === address._id);
+      for (const field of ['label', 'line2', 'city', 'state', 'postalCode', 'country'] as const) assert.equal(clearedAddress?.[field], '');
+      assert.equal((await request(fixture.user, `/users/me/addresses/${address._id}`, 'DELETE')).status, 204);
+      assert.equal((await request(null, '/admin/orders?search=01700000000', 'GET')).status, 401);
+      assert.equal((await request(fixture.user, '/admin/orders?search=01700000000', 'GET')).status, 403);
+      fixture.user.role = 'admin'; await fixture.user.save();
+      assert.equal((await request(fixture.user, '/admin/orders?search=.*', 'GET')).status, 400);
+      assert.equal((await request(fixture.user, '/admin/orders?search=01700000000', 'GET')).status, 200);
+    });
 
     it('returns 409 CHECKOUT_IN_PROGRESS without changing stock', async () => {
       const fixture = await makeFixture();
````

## New source: client/components/auth/AccountEditor.tsx

````typescript
'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';
import { AddressForm, type AddressFormErrors } from '@/components/checkout/AddressForm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { userApi } from '@/lib/api/user';
import { ApiError } from '@/lib/api/client';
import { addressUpdatePayload, optionalAddressFields, validateAddress, type AddressFormValues } from '@/lib/validation/address';
import type { Address } from '@/lib/types';

const empty: AddressFormValues = { fullName: '', phone: '', line1: '', isDefault: false };

export function AccountEditor() {
  const { user, refresh, updateUser, invalidateSession } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<AddressFormValues>(empty);
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [busy, setBusy] = useState(false);
  const requestActive = useRef(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const run = async (action: () => Promise<unknown>, text: string) => {
    if (requestActive.current || needsRefresh) return;
    requestActive.current = true;
    setBusy(true); setNotice(null);
    try {
      await action();
      const result = await refresh();
      if (result.status === 'error') {
        setNeedsRefresh(true);
        setNotice({ error: true, text: `${text} The latest account information could not be refreshed. Retry refresh to load it without saving again.` });
      } else if (result.status === 'ok') {
        setNeedsRefresh(false);
        setNotice({ error: false, text });
      }
    }
    catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) invalidateSession();
      else setNotice({ error: true, text: error instanceof ApiError ? error.message : 'Could not save changes. Please retry.' });
    }
    finally { setBusy(false); requestActive.current = false; }
  };
  const retryRefresh = async () => {
    if (requestActive.current) return;
    requestActive.current = true; setBusy(true);
    try {
      const result = await refresh();
      if (result.status === 'ok') {
        setNeedsRefresh(false);
        setNotice({ error: false, text: 'Latest account information refreshed.' });
      }
    } finally { setBusy(false); requestActive.current = false; }
  };
  const writeDisabled = busy || needsRefresh;
  const edit = (address: Address) => { setEditing(address._id); setValues({ ...address }); setErrors({}); };
  const saveAddress = (event: FormEvent) => {
    event.preventDefault(); const issues = validateAddress(values); setErrors(issues);
    if (Object.keys(issues).length) return;
    void run(async () => {
      const payload = addressUpdatePayload(values);
      const { address } = editing
        ? await userApi.patchAddress(editing, payload)
        : await userApi.createAddress(payload);
      updateUser((current) => ({ ...current, addresses: current.addresses.some((saved) => saved._id === address._id)
        ? current.addresses.map((saved) => saved._id === address._id ? address : saved)
        : [...current.addresses, address] }));
      // A confirmed create becomes an edit, so another submit cannot duplicate it.
      // Keep the form intact even when its subsequent readback fails.
      setEditing(address._id);
    }, 'Address saved.');
  };
  return <div className="mt-5 space-y-5" aria-busy={busy}>
    {notice ? <Notice tone={notice.error ? 'error' : 'success'}><span role="status">{notice.text}</span></Notice> : null}
    {needsRefresh ? <Button type="button" variant="secondary" disabled={busy} loading={busy} onClick={() => { void retryRefresh(); }}>Retry refresh</Button> : null}
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || name.trim().length > 100) { setNotice({ error: true, text: 'Enter a name between 1 and 100 characters.' }); return; }
      void run(async () => {
        const { user: saved } = await userApi.updateProfile(name.trim());
        updateUser(() => saved);
      }, 'Profile saved.');
    }}>
      <Input id="account-name" label="Your name" value={name} maxLength={100} required disabled={busy} autoComplete="name" onChange={(event) => setName(event.target.value)} />
      <Button type="submit" loading={busy} disabled={writeDisabled}>Save name</Button>
    </form>
    <h3 className="font-semibold">Saved addresses</h3>
    {user?.addresses.length === 0 ? <p className="text-sm text-muted">No saved addresses yet. Add a delivery address below.</p> : null}
    <ul className="space-y-3" aria-label="Manage saved addresses">
      {user?.addresses.map((address) => <li key={address._id} className="rounded-xl border border-line p-3">
        <p>{address.fullName}: {address.line1}{address.isDefault ? ' · Default' : ''}</p>
        <p className="text-sm text-muted">{address.phone}</p>
        <p className="text-sm text-muted">{[address.label, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={writeDisabled} onClick={() => edit(address)}>Edit address</Button>
          {!address.isDefault ? <Button type="button" variant="secondary" disabled={writeDisabled} onClick={() => void run(async () => {
            const { address: saved } = await userApi.patchAddress(address._id, { isDefault: true });
            updateUser((current) => ({ ...current, addresses: current.addresses.map((item) => item._id === saved._id ? saved : { ...item, isDefault: false }) }));
          }, 'Default address updated.')}>Set default</Button> : null}
          <Button type="button" variant="ghost" disabled={writeDisabled} onClick={() => {
            if (window.confirm('Delete this saved address? Existing orders keep their delivery address.')) void run(async () => {
              await userApi.deleteAddress(address._id);
              updateUser((current) => ({ ...current, addresses: current.addresses.filter((item) => item._id !== address._id) }));
              if (editing === address._id) { setEditing(null); setValues(empty); }
            }, 'Address deleted.');
          }}>Delete address</Button>
        </div>
      </li>)}
    </ul>
    <form className="space-y-3" onSubmit={saveAddress}>
      <h3 className="font-semibold">{editing ? 'Edit delivery address' : 'Add delivery address'}</h3>
      <AddressForm idPrefix="account-address" values={values} errors={errors} disabled={busy} onChange={(field, value) => setValues((previous) => ({ ...previous, [field]: value }))} />
      <fieldset className="grid gap-4" disabled={busy}>
        <legend className="mb-3 text-sm font-medium text-ink">Optional address details</legend>
        {optionalAddressFields.map(({ name: field, label, maxLength }) => <Input
          key={field} id={`account-address-${field}`} label={label} maxLength={maxLength}
          value={values[field] ?? ''} error={errors[field]}
          onChange={(event) => setValues((previous) => ({ ...previous, [field]: event.target.value }))}
        />)}
      </fieldset>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={values.isDefault ?? false} disabled={busy} onChange={(event) => setValues((previous) => ({ ...previous, isDefault: event.target.checked }))} />Use as default address</label>
      <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy} disabled={writeDisabled}>Save address</Button>
      {editing ? <Button type="button" variant="secondary" disabled={writeDisabled} onClick={() => { setEditing(null); setValues(empty); setErrors({}); }}>Add a new address</Button> : null}</div>
    </form>
  </div>;
}

````

## New source: client/lib/__tests__/account-refresh.test.ts

````typescript
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { refreshSession } from '../auth/refresh-session.ts';

it('accepts a successfully refreshed profile', async () => {
  const accepted: Array<string | null> = [];
  assert.equal((await refreshSession(async () => ({ user: 'saved' }), (user) => accepted.push(user))).status, 'ok');
  assert.deepEqual(accepted, ['saved']);
});
for (const [label, error] of [
  ['network failure', new TypeError('Failed to fetch')],
  ['timeout', Object.assign(new Error('Timed out'), { name: 'TimeoutError' })],
  ['server 503', Object.assign(new Error('Unavailable'), { status: 503 })],
] as const) {
  it(`preserves the authenticated profile after ${label}`, async () => {
    let current: string | null = 'confirmed saved profile';
    const result = await refreshSession<string>(async () => { throw error; }, (user) => { current = user; });
    assert.equal(result.status, 'error');
    assert.equal(current, 'confirmed saved profile');
  });
}
for (const status of [401, 403]) {
  it(`expires authentication on HTTP ${status}`, async () => {
    let current: string | null = 'old profile';
    const result = await refreshSession<string>(async () => { throw { status }; }, (user) => { current = user; });
    assert.equal(result.status, 'expired');
    assert.equal(current, null);
  });
}
it('retries the read after failure and accepts the latest profile', async () => {
  let reads = 0;
  let current: string | null = 'saved';
  const load = async () => { reads++; if (reads === 1) throw new Error('offline'); return { user: 'latest' }; };
  assert.equal((await refreshSession(load, (user) => { current = user; })).status, 'error');
  assert.equal((await refreshSession(load, (user) => { current = user; })).status, 'ok');
  assert.equal(current, 'latest'); assert.equal(reads, 2);
});

````

## New source: client/lib/__tests__/address-update.test.ts

````typescript
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { addressUpdatePayload, optionalAddressFields, validateAddress, type AddressFormValues } from '../validation/address.ts';

const required = { fullName: 'Customer', phone: '01712345678', line1: 'Dhaka' };
it('preserves and trims every supported optional value during editing', () => {
  const values: AddressFormValues = { ...required };
  for (const { name } of optionalAddressFields) values[name] = ` ${name} value `;
  const payload = addressUpdatePayload(values);
  for (const { name } of optionalAddressFields) assert.equal(payload[name], `${name} value`);
});
it('sends explicit empty and whitespace-only optional values as clear operations', () => {
  for (const empty of ['', '   ']) {
    const values: AddressFormValues = { ...required };
    for (const { name } of optionalAddressFields) values[name] = empty;
    const payload = addressUpdatePayload(values);
    for (const { name } of optionalAddressFields) assert.equal(payload[name], '');
  }
});
it('keeps omitted optional fields omitted from the PATCH payload', () => {
  const payload = addressUpdatePayload(required);
  for (const { name } of optionalAddressFields) assert.equal(Object.hasOwn(payload, name), false);
});
it('rejects invalid required fields', () => {
  const errors = validateAddress({ fullName: '', phone: 'invalid', line1: '' });
  assert.ok(errors.fullName && errors.phone && errors.line1);
});
it('validates the length of each supported optional field', () => {
  for (const { name, maxLength } of optionalAddressFields) {
    assert.ok(validateAddress({ ...required, [name]: 'x'.repeat(maxLength + 1) })[name]);
  }
});
it('normalizes a formatted phone and preserves an explicit default flag', () => {
  const payload = addressUpdatePayload({ ...required, phone: '+8801712345678', isDefault: false });
  assert.equal(payload.phone, '01712345678'); assert.equal(payload.isDefault, false);
});

````

## New source: client/lib/__tests__/public-content.test.ts

````typescript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { site } from '../../config/site.ts';

it('production storefront configuration contains no placeholder contact or social values', () => {
  assert.doesNotMatch(JSON.stringify(site), /example\.com|OWNER:|placeholder|"href":"#"/i);
  assert.equal(site.contact.email, '');
  assert.equal(site.contact.hours, '');
  assert.equal(site.socials.length, 0);
});
it('public information pages contain no internal setup instructions', () => {
  for (const page of ['about', 'contact', 'privacy', 'shipping-returns']) {
    const source = readFileSync(new URL(`../../app/${page}/page.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /hello@example|placeholder|OWNER:|replace this|edit this page/i);
  }
});
it('customer cancellation UI includes processing but excludes shipped orders', () => {
  const source = readFileSync(new URL('../../components/orders/OrderDetailClient.tsx', import.meta.url), 'utf8');
  assert.match(source, /order.status === 'pending' \|\| order.status === 'processing'/);
});

````

## New source: client/lib/auth/refresh-session.ts

````typescript
export type RefreshResult<T> =
  | { status: 'ok'; user: T }
  | { status: 'expired' }
  | { status: 'error'; error: unknown };

/** A readback failure is not evidence that an authenticated session expired. */
export async function refreshSession<T>(
  load: () => Promise<{ user: T }>,
  accept: (user: T | null) => void,
): Promise<RefreshResult<T>> {
  try {
    const { user } = await load();
    accept(user);
    return { status: 'ok', user };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error &&
        (error.status === 401 || error.status === 403)) {
      accept(null);
      return { status: 'expired' };
    }
    return { status: 'error', error };
  }
}

````

## New source: client/tests/account.browser.mjs

````javascript
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';

const base = new URL(process.env.ACCOUNT_TEST_BASE_URL ?? 'http://localhost:3033');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'browser tests require a local test server');
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, 'Set PLAYWRIGHT_MODULE_PATH to an existing Playwright installation');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function fixture(test, options = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  test.after(() => context.close());
  const user = { id: '111111111111111111111111', name: 'Account Customer', email: 'account-fixture@example.test', role: 'customer', addresses: [{
    _id: '222222222222222222222222', fullName: 'Account Customer', phone: '01712345678', line1: 'Old street',
    label: 'Home', line2: 'Flat 4', city: 'Dhaka', state: 'Dhaka', postalCode: '1200', country: 'Bangladesh', isDefault: true,
  }] };
  const state = { reads: 0, writes: 0, failRead: options.initialFailure ?? 0, afterSave: options.afterSave ?? 0, writeStatus: options.writeStatus ?? 200, addressPayload: null };
  // Every API response is synthetic. No account or database write reaches a server.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  await context.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    let status = 200; let body = { items: [] };
    if (url.pathname === '/api/auth/me') {
      state.reads++;
      status = state.failRead || 200;
      body = status === 200 ? { user } : { error: { code: 'SERVER_ERROR', message: 'Injected read failure' } };
    } else if (url.pathname === '/api/users/me' && request.method() === 'PATCH') {
      state.writes++; status = state.writeStatus;
      if (status === 200) { user.name = request.postDataJSON().name; state.failRead = state.afterSave; body = { user }; }
      else body = { error: { code: 'UNAUTHORIZED', message: 'Session expired' } };
    } else if (url.pathname.includes('/users/me/addresses/') && request.method() === 'PATCH') {
      state.writes++; state.addressPayload = request.postDataJSON();
      Object.assign(user.addresses[0], state.addressPayload); body = { address: user.addresses[0] };
    } else if (url.pathname === '/api/cart') body = { items: [], subtotal: 0, shippingFee: 0, total: 0 };
    await route.fulfill({ status, json: body });
  });
  const page = await context.newPage(); await page.goto(new URL('/account', base).href);
  return { page, state, user };
}

describe('corrective account browser regressions', () => {
  it('saves and refreshes once, preserving the confirmed name', async (t) => {
    const { page, state, user } = await fixture(t);
    await page.getByLabel('Your name', { exact: true }).fill('Saved Customer');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.getByText('Profile saved.', { exact: true }).waitFor();
    assert.equal(state.writes, 1); assert.equal(user.name, 'Saved Customer');
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Saved Customer');
    assert.equal(state.reads, 2);
  });

  it('retains a successful save after failed refresh, then retries only the read', async (t) => {
    const { page, state, user } = await fixture(t, { afterSave: 503 });
    await page.getByLabel('Your name', { exact: true }).fill('Confirmed Customer');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.getByText(/Profile saved\. The latest account information could not be refreshed/).waitFor();
    assert.equal(new URL(page.url()).pathname, '/account'); assert.equal(user.name, 'Confirmed Customer');
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Confirmed Customer');
    assert.equal(await page.getByRole('button', { name: 'Save name', exact: true }).isDisabled(), true);
    await page.getByLabel('Your name', { exact: true }).fill('Unsaved next edit');
    state.failRead = 0;
    await page.getByRole('button', { name: 'Retry refresh', exact: true }).click();
    await page.getByText('Latest account information refreshed.', { exact: true }).waitFor();
    assert.equal(state.writes, 1); assert.equal(state.reads, 3);
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Unsaved next edit');
    assert.equal(await page.getByRole('button', { name: 'Retry refresh', exact: true }).count(), 0);
  });

  for (const status of [401, 403]) {
    it(`redirects for a genuinely unauthorized refresh (${status})`, async (t) => {
      const { page, state } = await fixture(t, { afterSave: status });
      await page.getByLabel('Your name', { exact: true }).fill('Saved before expiration');
      await page.getByRole('button', { name: 'Save name', exact: true }).click();
      await page.waitForURL(/\/login/); assert.equal(state.writes, 1);
    });
  }

  it('redirects when the update request itself reports an expired session', async (t) => {
    const { page, state } = await fixture(t, { writeStatus: 401 });
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.waitForURL(/\/login/); assert.equal(state.writes, 1);
  });

  it('keeps an initial transient profile failure on the account route with a retry', async (t) => {
    const { page, state } = await fixture(t, { initialFailure: 503 });
    await page.getByText('Could not load your account', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/account');
    state.failRead = 0;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await page.getByLabel('Your name', { exact: true }).waitFor(); assert.equal(state.writes, 0);
  });

  it('displays, edits and clears all optional address values and rejects invalid required fields', async (t) => {
    const { page, state } = await fixture(t);
    await page.getByRole('button', { name: 'Edit address', exact: true }).click();
    const fields = [
      ['label', 'Address label (optional)', 'Home'], ['line2', 'Address line 2 (optional)', 'Flat 4'],
      ['city', 'City (optional)', 'Dhaka'], ['state', 'State or region (optional)', 'Dhaka'],
      ['postalCode', 'Postal code (optional)', '1200'], ['country', 'Country (optional)', 'Bangladesh'],
    ];
    for (const [key, label, value] of fields) {
      assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
      await page.getByLabel(label, { exact: true }).fill(`New ${key}`);
    }
    await page.getByLabel('Phone number', { exact: true }).fill('invalid');
    await page.getByRole('button', { name: 'Save address', exact: true }).click();
    await page.getByText('Enter a valid Bangladeshi mobile number.', { exact: true }).waitFor();
    assert.equal(state.writes, 0);
    await page.getByLabel('Phone number', { exact: true }).fill('+8801712345678');
    await page.getByRole('button', { name: 'Save address', exact: true }).click();
    await page.getByText('Address saved.', { exact: true }).waitFor();
    for (const [key] of fields) assert.equal(state.addressPayload[key], `New ${key}`);
    for (const [, label] of fields) await page.getByLabel(label, { exact: true }).fill('');
    const cleared = page.waitForResponse((response) => response.url().includes('/users/me/addresses/') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save address', exact: true }).click(); await cleared;
    for (const [key] of fields) assert.equal(state.addressPayload[key], '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
});

````

## New source: server/src/config/password.ts

````typescript
/** Shared work factor for all newly created password hashes. */
export const BCRYPT_COST = 12;

````

## Candidate SHA256 inventory

```json
{
  "API_DOCUMENTATION.md": "8ece6f6624973344cb12d3e7263740354bb2a03bcf49ea7e0dcbf51e943f5fca",
  "DEPLOYMENT.md": "2b581b67499ac3bdddff968878ff678bf9b8a0669db4aee4548194b49dcc9611",
  "client/app/about/page.tsx": "7e78fa7bf4030e87aa9bc05eea34336eba45044488477a5c8c05d9deb5162924",
  "client/app/contact/page.tsx": "8059065718b62c3ac651112c7c61516beac48563ba92011bed7efe542561cea3",
  "client/app/privacy/page.tsx": "f9756ac4582c784c822aaee756727fb407cd09ed9e121333205407043ee5b38d",
  "client/app/shipping-returns/page.tsx": "87dc0fe04b51223c2a27563f8471bae7d8e96e0f3bd3a5c7e229761800e1b52f",
  "client/components/admin/AdminOrders.tsx": "0e88676bbaa1850e90d5be56a926f708f3b656d950cd3b09a37feeb0a3b1d434",
  "client/components/auth/AccountPanel.tsx": "2db3b255a5dee1456273fb012e4d22f39870be5c8264ede3482e28f987e67d5a",
  "client/components/auth/AuthProvider.tsx": "fa5c06c2d5db9c965dfb00df926e2ef337c46106a22cf7e3af566173270057a8",
  "client/components/auth/RouteGuard.tsx": "be0e304c338b6ae10a5143d8617f7e23f41e79fe6fd79781f480ec1046c92e99",
  "client/components/layout/Footer.tsx": "4130c99370fcfb379ffa4b0dd3bb3fda3ce3e523bc36cd86f11758a6b1b6b9a8",
  "client/components/orders/OrderDetailClient.tsx": "6f05ce3f047f5872b32aeeec8c90d20c34af50bd0803c348d43456539e12f874",
  "client/config/site.ts": "50185688756e7e36f512f29dc5b21162eaaa57cc28bfaa9656be54d5cb99333e",
  "client/lib/api/admin.ts": "f71e8532c584fa479a7bd6f4300fabe2d6d37e505ea19ea615c794aa7f67c4a1",
  "client/lib/api/user.ts": "acdcd122c8b7420b80d7e6d7382d8fd10e9c0eb3a27da594e48d1c67142f07a7",
  "client/lib/validation/address.ts": "708932675598d1c6be5c3e80381730adcfd4f4bb4da5e11557e8126e3399287a",
  "client/package.json": "a1108b1d607670a4c24378f3e86ae5d8603e35edf99ccd5c8ebaa7b7ec43e167",
  "server/src/models/order.model.ts": "d4dbe63509670f19f52de6fe6c5a3b33bc8438f9d99b0b6f7df30d980994c0bb",
  "server/src/schemas/admin.schema.ts": "ba474ab01eb84aeebe0bdb034afc68e13140d5d91740033712d7d4aee4073c6e",
  "server/src/scripts/seed.ts": "6756b27265b7160daecff5ba24587762fc16446b862ec885ea3512fe4b3f941d",
  "server/src/services/admin-order.service.ts": "fb5cca43200d8a1e87124180e9eb59237ffb5711ad8b3e30ad9b9a8856e88cc2",
  "server/src/services/auth.service.ts": "a9fbe0698c5f480af80c405ccd5d3936ced9e8cbce29fff455e9a266294d61d6",
  "server/src/services/order.service.ts": "c9f8b77ab980177720ec3697636d25629fa80a2086eeea34b581c8884cc60b59",
  "server/src/services/user.service.ts": "ffb4fdaa53963d797c1cb71167dda90c7ed018f1ac714399fd109683e9031096",
  "server/test/order-integrity.test.ts": "0e1b98b1985020f20de499fe69860674c1f11c41d0c2ce52568104476dfeeef6",
  "client/components/auth/AccountEditor.tsx": "cb0ee794fe135f8a2e677c5d803c2f4370a9ecabff1fd2966b33da2295dadd75",
  "client/lib/__tests__/account-refresh.test.ts": "0d54f56d544bf6416305e40e0f7c1c4a4c73cd51980d9f14dcfb0e00fe6ee8ac",
  "client/lib/__tests__/address-update.test.ts": "baa29d5835db5eb667dd62d33e7cba9ad8eef3128485cd75616ec18ee839993f",
  "client/lib/__tests__/public-content.test.ts": "5d0bfe8effa582955966676090930b88009c0806b85d935bef0363743c740f67",
  "client/lib/auth/refresh-session.ts": "ba48e93485357fa07970d50c0bf183f1f089b449054d100ca403616170c1a5e6",
  "client/tests/account.browser.mjs": "3e0313ef2c20107bfadfb1979a8ba35f1809767f33b15f237c3194b3299956ac",
  "server/src/config/password.ts": "68a82dba8c99d8e3b287f1b5759542d051c5ee909cd94b1100949389bb1e382e"
}
```
