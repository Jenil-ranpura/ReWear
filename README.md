# ReWear 👕♻️

Community clothing-exchange platform: list unused garments, swap them 1:1, or redeem via a points economy. Reducing textile waste, one swap at a time.

**Stack:** MongoDB (Atlas) · Express · React 18 (Vite) · Node — plain JavaScript, ESM. **No Docker anywhere** (dev, CI, or deployment).

> **Source of truth:** `implementation.md` (what should be built) · `progress.md` (what has been built). The codebase wins on any conflict.

---

## Repository layout (npm workspaces)

```
rewear/
├── apps/
│   ├── api/                  # Express backend (ESM, plain JS)
│   └── web/                  # React + Vite frontend
├── packages/
│   └── shared-schemas/       # Yup schemas + status enums shared by web & api
├── implementation.md         # Spec: what to build
└── progress.md               # Living execution state
```

## Prerequisites

- **Node.js ≥ 22** and **npm ≥ 10** (`node -v`, `npm -v`)
- A free **MongoDB Atlas** account — this replaces a local database install entirely. **Do not install Docker or a local `mongod`.** The swap-accept flow depends on multi-document transactions, which a standalone local Mongo does *not* support (Atlas free tier runs as a replica set and does).

## 1. Create the Atlas dev cluster (`P0-T3`)

1. Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) → build a **free M0** cluster.
2. **Database Access** → add a database user (username + password).
3. **Network Access** → add your IP (or `0.0.0.0/0` for hackathon convenience).
4. **Connect → Drivers** → copy the `mongodb+srv://…` connection string.
5. Name the dev database `rewear-dev` (in the path portion of the URI). Production will later use a separate name/cluster — never point dev tooling at the prod database.

## 2. Environment files

```bash
cp apps/api/.env.example apps/api/.env     # fill in MONGODB_URI, JWT secrets, etc.
cp apps/web/.env.example apps/web/.env     # fill in VITE_API_BASE_URL
```

Every variable is documented with placeholders in the `.env.example` files. **Never commit real `.env` files.**

Generate JWT secrets with:

```bash
openssl rand -hex 32   # run twice — one for ACCESS, one for REFRESH
```

## 3. Install & run

```bash
npm install            # at the repo root — installs all three workspaces

npm run dev            # api (PORT 4000) + web (Vite, 5173) in parallel
# or individually:
npm run dev:api
npm run dev:web
```

- Backend health check: `GET http://localhost:4000/health` → `{"status":"ok","db":"connected"}`
- Frontend: `http://localhost:5173`

## 4. Tests & linting

```bash
npm test               # backend: Jest + Supertest + mongodb-memory-server (no Docker, no external DB)
npm run lint           # ESLint across all workspaces
npm run format:check   # Prettier
```

## 5. Seed data

```bash
npm run seed           # implemented in Phase 2 (P2-T3); refuses to run in production
```

## Environment variables reference

Authoritative list: `implementation.md §18`.

| Variable | App | Purpose |
|---|---|---|
| `MONGODB_URI` | api | Atlas replica-set connection string (transactions required) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | api | Token signing (rotate refresh on every refresh) |
| `CLOUDINARY_URL` | api | Image storage |
| `VISION_API_PROVIDER` / `VISION_API_KEY` | api | AI classification (advisory-only, never blocks listing) |
| `NODE_ENV` / `PORT` / `CORS_ORIGIN` | api | Runtime config |
| `VITE_API_BASE_URL` | web | Backend API base URL |

## Deployment (later phases)

Frontend → Vercel · Backend → Railway/Render · DB → the production Atlas database. All direct Node/app deploys — no Dockerfile, ever.
