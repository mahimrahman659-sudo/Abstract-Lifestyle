# Abstract Lifestyle

A small e-commerce MVP: a **clothing + everyday lifestyle** storefront with a customer-facing
shop (catalog, cart, Cash-on-Delivery checkout, order history) and an admin dashboard for catalog,
stock and order management.

## Stack

| Layer | Tech |
|---|---|
| Client (`/client`) | Next.js (App Router) · TypeScript strict · Tailwind CSS v4 · `next/image` |
| API (`/server`) | Node.js · Express 5 · TypeScript strict · MongoDB (Mongoose) · Zod validation |
| Auth | JWT in an **httpOnly** cookie (`al_token`), bcryptjs hashing |
| Money | BDT, integer poisha (100 poisha = 1 BDT) — single `client/config/currency.ts` constant |

## Folder structure

```
/client
  app/                 routes (App Router): products, cart, checkout, orders, account, auth, admin, static pages
  components/          UI kit (ui/), catalog, cart, checkout, orders, admin, layout, providers
  lib/                 api clients, types, utils (money), validation mirrors, seo helpers
  config/              currency config (single source of truth)
/server
  src/
    config/            env validation (zod), db connection, paths
    models/            Mongoose models (users, categories, products, variants, carts, orders)
    schemas/           Zod input schemas (all API input validated)
    routes/            route definitions only
    controllers/       request/response handling
    services/          business logic (cart, orders, payments, admin, uploads)
    middleware/        auth, validation, error handler, rate limit, upload
    utils/             jwt, slug, order number, stock helpers
    scripts/seed.ts    database seeding
  uploads/             uploaded product images (git-ignored, served at /uploads)
```

## Prerequisites

- Node.js 20+ and npm
- MongoDB — local (`mongodb://127.0.0.1:27017`) or a MongoDB Atlas cluster

## Setup

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install

# 2. Configure environment files (copy the examples, then fill in values)
cp server/.env.example server/.env
cp client/.env.example client/.env.local

# 3. Seed the database (admin user, categories, demo products)
cd server && npm run seed

# 4. Run both apps (two terminals)
cd server && npm run dev      # API on http://localhost:4000
cd client && npm run dev      # Storefront on http://localhost:3000
```

Sign in at `/login` (the admin link appears for admin accounts) and manage the store at `/admin`.

## Environment variables

### Server (`server/.env`)

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` (default) \| `production` \| `test`. Production enables secure cookies and strict startup checks |
| `PORT` | Port for the Express API (default `4000`) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWTs — **min 32 characters** (production refuses to start otherwise) |
| `CLIENT_ORIGIN` | Exact storefront origin; CORS is locked to it (default `http://localhost:3000`) |
| `SHIPPING_FEE` | Flat shipping fee in **poisha** (integer, default `0`) |
| `ADMIN_EMAIL` | Seed admin email (used by the seed script) |
| `ADMIN_PASSWORD` | Seed admin password. In production it must be strong (12+ chars, not "change-me"/"password"/the email) or the API refuses to start |
| `TRUST_PROXY` | Express `trust proxy` setting — empty locally, `1` behind one reverse proxy |

### Client (`client/.env.local`)

| Variable | Purpose |
|---|---|
| `API_URL` | Base URL of the Express API used by the Next.js rewrites (default `http://localhost:4000`) |
| `NEXT_PUBLIC_SITE_URL` | Public storefront origin for metadata/Open Graph, `robots.txt` and `sitemap.xml` (default `http://localhost:3000`) |

## Seeding

```bash
cd server
npm run seed                 # admin + category trees + demo products (development)
npm run seed -- --admin-only # admin + category trees only (production-safe)
```

Both variants are idempotent (upserts).

## Changing a user's role

```bash
cd server
npm run set-role -- --email someone@example.com --role admin   # or: --role customer
```

Existing accounts only — the person must have registered or signed in once first; the script never
creates users and never touches passwords or Google links. It prints just the email and the
resulting role, and refuses to demote the **last remaining admin**. In production, build first and
use `npm run set-role:prod -- --email … --role …` (or run it from the host's shell).

## API proxy setup

The browser never talks to the API host directly. `client/next.config.ts` rewrites same-origin
paths to Express:

| Next.js path | Proxied to |
|---|---|
| `/api/*` | `${API_URL}/api/*` |
| `/uploads/*` | `${API_URL}/uploads/*` |

This keeps requests same-origin so the httpOnly auth cookie works without CORS in the browser, and
lets `next/image` optimise uploaded images. On a single host, run Next.js on 80/443 and the API on
a private port; set `API_URL` to that internal origin.

## Build & run in production

```bash
# API
cd server
npm run build     # compiles TypeScript to dist/
npm start         # node dist/index.js
npm run seed:prod -- --admin-only   # optional first-time admin/categories seed

# Client
cd client
npm run build     # production build
npm start         # Next.js production server
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full go-live checklist.

## Documentation

- `PROJECT_CONTEXT.md` — product scope, decisions, security notes
- `API_DOCUMENTATION.md` — every endpoint, roles, request/response shapes
- `DATABASE_SCHEMA.md` — collections, fields, indexes
- `ROADMAP.md` — build phases and tasks
- `DEPLOYMENT.md` — production checklist

