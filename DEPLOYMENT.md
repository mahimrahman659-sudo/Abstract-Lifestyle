# Deployment checklist — Abstract Lifestyle

A go-live checklist for the Next.js client (`/client`) and Express API (`/server`). Work through
each section before exposing the store to real customers.

## 1. Environment variables

### API (`server/.env` in production)

| Variable | Production requirement |
|---|---|
| `NODE_ENV` | `production` — enables secure cookies and strict startup validation |
| `PORT` | Port the API listens on (often injected by the host) |
| `MONGODB_URI` | Atlas connection string with a **dedicated database user** limited to this database; never the admin user |
| `JWT_SECRET` | 32+ random characters (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). The API **refuses to start** if shorter |
| `CLIENT_ORIGIN` | Exact public storefront origin (e.g. `https://shop.example.com`) — CORS is locked to it |
| `SHIPPING_FEE` | Flat fee in poisha (integer; `0` = free shipping) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Used by the seed script. The API refuses to start if `ADMIN_PASSWORD` is weak (12+ chars, not "change-me"/"password"/the email) |
| `TRUST_PROXY` | `1` when running behind one reverse proxy / PaaS router. **The API refuses to start in production when this is unset** |
| `API_RATE_LIMIT_PER_MIN` | Global per-IP API limit (default 300/min) |
| `ORDER_RATE_LIMIT_PER_MIN` | Per-user checkout limit (default 30/min) |
| `UPLOAD_RATE_LIMIT_PER_MIN` | Per-user admin upload limit (default 20/min) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (public — appears in image URLs) |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret — **required in production**; never logged or exposed to the client |
| `GOOGLE_CLIENT_ID` | Google Identity Services client id (public — also shipped to the browser as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Used to verify Google ID tokens server-side. **Required in production** |

### Client (`client/.env.local` / host env)

| Variable | Production requirement |
|---|---|
| `API_URL` | Internal/public origin the Next.js server uses to reach the API (e.g. `http://127.0.0.1:4000` on one host) |
| `NEXT_PUBLIC_SITE_URL` | Public storefront origin, used by metadata, canonical/OpenGraph URLs, `robots.txt` and `sitemap.xml`. **Required for production builds and local `next start`**, with an absolute `https` origin that is not a loopback host (e.g. `https://abstract-lifestyle.vercel.app`). Vercel preview builds enforce the same validation; when unset they require a valid HTTPS `VERCEL_URL` instead. Normal development allows localhost. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Identity Services client id (public by design — it configures the hosted Google button) |

### Vercel (client)

The client is a **monorepo subdirectory** (`client/`). After importing the Git repo into a Vercel project, set **Project Settings → Build and Deployment → Root Directory = `client`** — otherwise `vercel build` runs against the repo root `package.json` and fails with `No Next.js version detected` (the root file has no `next` dependency; the app lives in `client/`). This is a dashboard setting; `vercel.json` cannot set it.

The Express API (`server/`) is **not** part of the Vercel deployment — host it separately (e.g. Render/Railway/Fly) and set `API_URL` in the Vercel project to that origin so the client's `/api/*` rewrites reach it. Set the client env table above (Production) in the Vercel project; at minimum `API_URL` and `NEXT_PUBLIC_SITE_URL`.

### Render (server)

New Web Service → connect the repo, then:

| Field | Value |
|---|---|
| Root Directory | `server` |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Region | any (pick one near the MongoDB cluster) |

The `--include=dev` flag is required: `NODE_ENV=production` (set as a service env var) makes a plain `npm install` skip devDependencies, and the build needs `typescript` + `@types/node` (`tsc` fails with `TS2688: Cannot find type definition file for 'node'` otherwise). The repo does not commit `package-lock.json`, so Render resolves dependencies fresh on every deploy.

Set the **server** env table above (Production) in the Render dashboard; `TRUST_PROXY=1` is mandatory (Render proxies all traffic) and `PORT` is injected by Render — do not set it. Allow Render's outbound IPs in MongoDB Atlas Network Access. After the first deploy, run the seed once (`npm run seed:prod -- --admin-only`, or locally against the prod `MONGODB_URI`) unless the database is already seeded. Finally set `API_URL` in Vercel to the Render service URL (`https://<name>.onrender.com`) and redeploy the Vercel project; set `CLIENT_ORIGIN` on Render to the Vercel origin.

### Local database (replica set required)

Phase 1 seed safety: newly inserted demo products are drafts until legitimate images
and variants satisfy the existing publishing rules. Repeat seeding preserves existing
password hashes, product edits and inventory. All new password hashes use cost 12.
Existing lower-cost admin hashes require verified-owner credential rotation through a
controlled maintenance process: hash a new strong password with the shared cost 12,
never rehash the old hash or print plaintext credentials. Rerunning the seed does not
rotate credentials. Do not run demo seeding against production.

Admin order search accepts a complete order number or a complete Bangladesh mobile
number (local, +880 or 880 format), combined with status and pagination. Deploy the
new `shippingAddress.phone/createdAt/_id` and `shippingAddress.phone/status/createdAt/_id`
indexes through the normal database index rollout before relying on large-catalog
search performance. No migration or production index write was performed here.

Order checkout, cancellation and admin variant/product deletion use multi-document transactions. The API **refuses to start** against a standalone `mongod` and prints the fix. Run a single-node replica set locally:

```bash
mongod --replSet rs0 --dbpath ./data --port 27017
mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
```

Then use `MONGODB_URI=mongodb://127.0.0.1:27017/abstract_lifestyle?replicaSet=rs0&directConnection=true` (see `server/.env.example`). Managed MongoDB (Atlas, Render, etc.) already runs a replica set. `GET /api/health` reports `{ ok, transactions }` so a wrong topology is visible.

Integration tests need a **disposable** replica set; see `server/test/README.md`. Never point them at production.

- [ ] Every variable above is set from the host's secret manager — never committed to the repo
- [ ] `server/.env.example` and `client/.env.example` list every variable used in code
- [ ] `git grep -I "mongodb+srv"`, `git grep "JWT_SECRET="` etc. show only placeholders

## 2. MongoDB Atlas IP allowlist

- [ ] Replace any `0.0.0.0/0` dev rule with the **specific egress IPs** of the API host
      (static IPs / NAT gateway / Atlas Private Endpoint where available)
- [ ] Keep the network-access list to the minimum needed for the database user
- [ ] Verify backups are enabled on the cluster

## 3. HTTPS

- [ ] Terminate TLS at the host/reverse proxy and force HTTPS (redirect 80 → 443)
- [ ] The auth cookie is `secure: true` in production — login **will not work over plain HTTP**
- [ ] `NEXT_PUBLIC_SITE_URL` and `CLIENT_ORIGIN` use `https://`

## 4. Cookies & proxy settings

- [ ] Cookie: `httpOnly: true`, `sameSite: 'lax'`, `secure` (automatic when `NODE_ENV=production`), 7-day TTL
- [ ] Set `TRUST_PROXY=1` behind exactly one proxy so rate limiting and cookies see the real client IP/protocol
      — the API **refuses to start** in production when `TRUST_PROXY` is unset
- [ ] Rate limits are active: global per-IP baseline (`API_RATE_LIMIT_PER_MIN`, default 300/min),
      per-user checkout (`ORDER_RATE_LIMIT_PER_MIN`, default 30/min) and per-user admin uploads
      (`UPLOAD_RATE_LIMIT_PER_MIN`, default 20/min); auth remains 10 attempts / 15 min / IP
- [ ] Never expose the API port publicly without TLS; keep browser traffic on the Next.js origin
      (`/api/*` and `/uploads/*` are proxied by Next.js rewrites)
- [ ] Rotating `JWT_SECRET` signs everyone out — plan rotations accordingly
- [ ] Auth endpoints are rate limited (10 requests / 15 min / IP); reverse proxies should not cache them

## 5. Image storage (Cloudinary)

Product images are uploaded to **Cloudinary** (`abstract-lifestyle/products` folder; public_id
generated by Cloudinary — client filenames are never used). Uploads are content-verified
(jpeg/png/webp, ≤ 5 MB each, ≤ 10 per request) before they leave the API.

- [ ] `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` set in the API host
      secrets (the API refuses to start in production without them)
- [ ] `CLOUDINARY_CLOUD_NAME` also available to the **client build** so `next/image` can restrict
      `res.cloudinary.com` to your cloud path (the cloud name is public; the secret is not)
- [ ] Removing an image from a product (or hard-deleting a product) deletes the Cloudinary asset;
      delete failures are logged with the public_id only and do not block the admin action
- [ ] `/uploads` is still served statically **for legacy local-disk images only** — new uploads never
      write to `server/uploads`; migrate or drop legacy files when convenient

## 6. Creating the admin user safely

- [ ] Generate a strong, unique password (12+ characters) and set it as `ADMIN_PASSWORD` in the
      host's secret manager **before** seeding
- [ ] Seed only what production needs:

```bash
cd server
npm run build
npm run seed:prod -- --admin-only   # admin + category trees only, no demo products
```

- [ ] Do **not** run the demo seed (`npm run seed`) against a production database
- [ ] Sign in once, create real categories/products in `/admin`, then treat the seeded admin as the
      only admin account (rotate the password after handover if it was shared)
- [ ] Promote/demote accounts with `npm run set-role:prod -- --email <email> --role <admin|customer>`
      (existing users only — the account must sign in once first; it never creates users, never
      touches passwords, and refuses to demote the last remaining admin)
- [ ] After deploying the variant normalisation change, run
      `npm run normalize-variants:prod` once against the live database (dry-run: it only reports),
      review the list, then re-run with `-- --apply`. It normalises legacy size/colour values
      (`s` → `S`, `white` → `White`, blanks → none) and skips any row that would collide with an
      existing size/colour pair. Safe to run again; a second run reports 0 changes.
- [ ] Never reuse the example credentials from `.env.example`

## 7. Final go-live checks

- [ ] `npm run build` succeeds for both apps; API `npm start` serves `GET /api/health` → `200`
- [ ] Storefront `npm run build && npm start` responds on the public origin
- [ ] `https://<origin>/robots.txt` disallows `/admin`, `/checkout`, `/cart`, `/orders`, `/login`, `/register`
- [ ] `https://<origin>/sitemap.xml` lists home, products, product pages and categories
- [ ] Smoke test: browse → add to cart → register → checkout (COD) → order confirmation → cancel
- [ ] Admin smoke test: product/variant CRUD, image upload, order status transitions
- [ ] Type-check + lint are clean in both apps

## 8. Known tradeoffs

- **Stateless JWT sessions.** Tokens are signed with `JWT_SECRET` and live 7 days; there is no
  server-side session store. `POST /auth/logout` only clears the cookie — a copied token stays valid
  until it expires, and changing a password does not revoke existing tokens. Rotating
  `JWT_SECRET` invalidates **all** sessions at once.
- **Admin password rotation** is done by updating `ADMIN_PASSWORD` in the environment and re-running
  the seed script (`npm run seed:prod -- --admin-only`); there is no in-app password-change flow yet.

