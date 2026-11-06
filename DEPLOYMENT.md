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

### Client (`client/.env.local` / host env)

| Variable | Production requirement |
|---|---|
| `API_URL` | Internal/public origin the Next.js server uses to reach the API (e.g. `http://127.0.0.1:4000` on one host) |
| `NEXT_PUBLIC_SITE_URL` | Public storefront origin (used by metadata, `robots.txt`, `sitemap.xml`) |

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

## 5. Uploads storage warning (local disk)

Uploaded product images are written to `server/uploads/` on **local disk**.

> ⚠️ Local disk is **ephemeral** on most hosts (Railway, Render, Heroku, container platforms):
> uploads are lost on redeploy/restart, and they are not shared between instances.

- [ ] Either mount a **persistent volume** at `/server/uploads` and run a single instance, or
- [ ] Move uploads to object storage (S3/R2/GCS) before scaling horizontally — the upload service is
      the only place that needs to change
- [ ] Upload limits stay enforced: jpeg/png/webp, ≤ 5 MB each, ≤ 10 per request, magic-byte verified

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
- [ ] Never reuse the example credentials from `.env.example`

## 7. Final go-live checks

- [ ] `npm run build` succeeds for both apps; API `npm start` serves `GET /api/health` → `200`
- [ ] Storefront `npm run build && npm start` responds on the public origin
- [ ] `https://<origin>/robots.txt` disallows `/admin`, `/checkout`, `/cart`, `/orders`, `/login`, `/register`
- [ ] `https://<origin>/sitemap.xml` lists home, products and categories
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

