# ReWear — Complete Project Context (AI Primer)

**Purpose:** paste this document into any AI chat (ChatGPT / Claude) as the authoritative primer for the ReWear codebase. It describes the app exactly as it is today, the locked-in constraints, every data model and endpoint, the shipped features, and the conventions any new code must follow.

**Last synced with code:** 2026-09-22 — featured carousel ACTUALLY shipped (latest-4 design), fixed session window documented, admin moderator-only nav contract, saved-items/location-filter drift corrected (§16).

---

## 1. What ReWear is

ReWear is a **community clothing-exchange platform** (hackathon Problem Statement 3). Users list unused garments and exchange them via **(a) direct 1:1 swaps** or **(b) a point-based redemption economy**. Mission: promote sustainable fashion and reduce textile waste by keeping wearable garments in circulation instead of discarded.

**Original problem-statement requirements — ALL shipped:**

- **User Authentication** — email/password signup and login
- **Landing Page** — platform intro; CTAs “Start Swapping”, “Browse Items”, “List an Item”; **featured items carousel**
- **User Dashboard** — profile details + points balance, uploaded items overview, ongoing and completed swaps list
- **Item Detail Page** — image gallery, full description, uploader info, “Swap Request” / “Redeem via Points” options, availability status
- **Add New Item** — upload images; title, description, category, type, size, condition, tags; submit to list
- **Admin Role** — moderate and approve/reject item listings, remove inappropriate or spam items, lightweight admin panel

**Roles:** Guest (browse/view only) · User (list, swap, redeem, manage dashboard) · Admin (moderate, ban users, view everything, disputes console).

---

## 2. Locked-in constraints (never violate)

| Constraint | Detail |
|---|---|
| Stack | MERN — MongoDB (Atlas), Express, React 18 + Vite, Node ≥ 22 (npm ≥ 10) |
| Language | Plain JavaScript, ESM everywhere. **No TypeScript** (type-safety via shared Yup schemas instead) |
| **No Docker** | Not in dev, CI, or deployment — ever. Dev DB = free MongoDB Atlas M0 (replica set → transactions work). Tests = `mongodb-memory-server` (`MongoMemoryReplSet`) |
| Monorepo | npm workspaces: `apps/api`, `apps/web`, `packages/shared-schemas` |
| Money | Points are **non-monetary**. No payments, no shipping/logistics, no social login (explicitly excluded) |
| Public profile pages | **Deliberately dropped by product decision.** Do not add or suggest them |
| Architecture | Single Express modular monolith; SPA talks only to our API (third-party keys stay server-side); no microservices, no message bus |

---

## 3. Repository layout

```
rewear/
├── apps/
│   ├── api/                      # Express backend (plain JS, ESM)
│   │   ├── src/
│   │   │   ├── config/env.js     # fail-fast env validation (JWT secrets required, min 32 chars, must differ)
│   │   │   ├── lib/              # db (sanitizeFilter set here), logger, withTransaction, reconcilePoints,
│   │   │   │                     #   pointsFormula (re-export), visionClassificationService, visionProvider (Groq)
│   │   │   ├── middleware/       # requireAuth, requireAdmin, validate, errorHandler, rateLimit, requestLogger
│   │   │   ├── models/           # User, Item, SwapRequest, PointsTransaction, AdminAction, Report (+ index barrel)
│   │   │   ├── modules/          # auth, items, swaps, users, admin (service/controller/routes per module)
│   │   │   ├── routes/health.js  # GET /health (mongoose readyState → 503 when degraded)
│   │   │   ├── app.js            # Express app, NO DB side effects at import (Supertest-ready)
│   │   │   └── server.js         # boot: env → listen → connect; graceful shutdown on SIGINT/SIGTERM
│   │   ├── seed/seed.js          # deterministic re-runnable seed (refuses in production without --force)
│   │   ├── scripts/              # verify-db, verify-transactions, p5/p6-live-verify, e2e-ensure-fixtures
│   │   └── tests/                # unit + integration (mongodb-memory-server replset)
│   └── web/                      # React 18 + Vite + Tailwind CSS v4
│       ├── src/{pages,components,hooks,lib,state,styles}
│       ├── e2e/journey.spec.js        # Playwright E2E journey (full real stack)
│       ├── e2e/session-expiry.spec.js # fixed-session-window E2E (isolated short-TTL stack)
│       ├── playwright.config.mjs      # journey: API :4000 + Vite :5173 (/api proxy)
│       ├── playwright.session-expiry.config.mjs # expiry: API :4001 + Vite :5174, SESSION_TTL_MINUTES=0.2
│       └── tests/                     # Vitest + React Testing Library
├── packages/shared-schemas/      # Yup schemas + status enums + pointsFormula — shared web↔api, single source of truth
├── implementation.md             # spec (what should be built)
├── progress.md                   # living execution log (what was built, decisions, gotchas)
└── AI-CONTEXT.md                 # this file
```

---

## 4. Commands

```bash
npm install              # at root — installs all three workspaces
npm run dev              # API (:4000) + web (:5173) in parallel
npm test                 # API: Jest + Supertest + mongodb-memory-server
npm run test:web         # Web: Vitest + RTL
npm run test:e2e:session # Playwright session-expiry E2E (own short-TTL stack; journey = apps/web `npm run test:e2e`)
npm run seed             # deterministic dev-DB seed (prod-safe)
npm run lint             # ESLint, all workspaces
npm run format:check     # Prettier
npm run build            # web production build (Vite)
```

Health check: `GET http://localhost:4000/health` → `{"status":"ok","db":"connected"}`.

---

## 5. Data models (MongoDB / Mongoose)

### `users`
```js
{ name, email (unique index), passwordHash (select: false), avatarUrl?, location?,
  phone? /* optional, signup-volunteered, E.164 */,
  role: 'USER'|'ADMIN' (default USER), pointsBalance /* denormalized cache; schema default 25 — see §6 */,
  isBanned: false, refreshTokenHash (select: false), sessionExpiresAt /* absolute window deadline — see §7 */,
  createdAt, updatedAt }
```

### `items`
```js
{ ownerId (ref User), title, description,
  category /* enum: JACKETS DRESSES COATS TOPS SHOES ACCESSORIES OTHER */,
  type, size,
  condition /* enum: NEW LIKE_NEW GOOD FAIR WORN */,
  tags: [String],
  pointValue /* SERVER-DERIVED: base(category) × multiplier(condition); clients can NEVER set it */,
  aiSuggestedCategory?, aiSuggestedCondition?, aiConfidence?,   // audit trail of AI suggestion
  images: [{ url, isPrimary, perceptualHash? }]                 // EMBEDDED subdocs, never separate collection
  status /* enum: PENDING APPROVED REJECTED RESERVED PENDING_TRANSFER SWAPPED REMOVED, default PENDING */,
  moderationReason?, createdAt, updatedAt }
```
Indexes: `{ status: 1, category: 1 }` compound, `{ ownerId: 1 }`, `images.perceptualHash` multikey (duplicate detection).

### `swaprequests`
```js
{ itemId (ref Item), requesterId (ref User),
  participants: [ownerId, requesterId]  /* snapshot at creation — contact reveal + list keying */,
  requesterPhone? /* E.164, volunteered on the request; owner sees it ONLY on ACCEPT; scrubbed on REJECT/CANCEL */,
  offeredItemId? /* required iff type = DIRECT_SWAP */,
  type: 'DIRECT_SWAP'|'POINTS_REDEMPTION',
  status: 'PENDING'|'ACCEPTED'|'REJECTED'|'CANCELLED' (default PENDING),
  createdAt, updatedAt }
```
Indexes: `{ itemId: 1 }`, `{ requesterId: 1 }`.

### `pointstransactions` — **append-only ledger** (no updates/deletes, ever)
```js
{ userId (ref User), amount /* + credit / − debit */,
  type: 'EARNED'|'SPENT'|'ADJUSTED', relatedSwapRequestId?, createdAt }
```

### `adminactions` — audit trail
```js
{ adminId, targetType /* "Item"|"User" */, targetId, action /* APPROVE|REJECT|BAN|REFUND|... */, reason?, createdAt }
```

### `reports` — dispute kit (fraud response)
```js
{ swapRequestId, reporterId, againstId /* snapshot counterparty */,
  reason: 'NO_SHOW'|'ITEM_NOT_AS_DESCRIBED'|'FAKE_ITEM'|'OTHER',
  details? /* ≤500 chars */,
  status: 'OPEN'|'RESOLVED'|'DISMISSED' (default OPEN),
  remedy: 'REFUND'|'NONE'|null, resolutionNote? /* REQUIRED ≥10 chars at close */,
  resolvedBy?, resolvedAt?, createdAt, updatedAt }
```
Indexes: `{ swapRequestId: 1, status: 1 }` (dedupe), `{ status: 1, createdAt: 1 }` (queue).

---

## 6. Points economy

- **Formula (deterministic, explainable, shown to the user):** `pointValue = basePoints[category] × conditionMultiplier[condition]`
  - base: JACKETS 40 · DRESSES 45 · COATS 55 · TOPS 25 · SHOES 30 · ACCESSORIES 15 · OTHER 20
  - multipliers: NEW 1.5 · LIKE_NEW 1.2 · GOOD 1.0 · FAIR 0.7 · WORN 0.4
- Lives in `packages/shared-schemas/src/pointsFormula.js` (api re-exports it) — the UI grid and the server's computation can never drift.
- **`pointValue` is never user-settable**: the service derives it via `computeSuggestedPoints(category, condition)` on create and on category/condition change; a client-smuggled value is stripped/ignored (schema fail-closed transform), NOT errored. The form field is read-only with an explanatory hint.
- **Invariant (test-enforced):** `users.pointsBalance` is a cache and must ALWAYS equal `Σ pointstransactions.amount` for the user. Every balance change writes a ledger doc **in the same transaction**. `lib/reconcilePoints.js` is session-aware and used in tests/scripts.
- New users start at a schema-default **25 points** (user decision, commit "changing the default coins"; **re-confirmed as final** — user decision, tests aligned). KNOWN DIVERGENCE: the grant is NOT ledger-backed — registration writes no EARNED doc, so a freshly registered user's cache ≠ Σ ledger until their first transaction; reconcile at P10 (write the grant as a ledger doc) or accept and document. There is no top-up endpoint (no payments by design) — the seed funds the demo user.

---

## 7. Authentication & security model

- **JWT access token** (15 min default, `{ userId, role }`) + **opaque refresh token** delivered as httpOnly `sameSite=strict` cookie scoped to `/api/v1/auth`, stored **only as SHA-256 hash** (`users.refreshTokenHash`, `select: false`), **rotated on every refresh** → replaying a rotated cookie gets 401 (reuse detection for free).
- **Fixed session window (user request):** `SESSION_TTL_MINUTES` (default 15, fractional allowed for e2e) — login/register stamps an ABSOLUTE `users.sessionExpiresAt`; refresh rotates the token but NEVER extends the deadline. When it passes, refresh and every protected route reject → instant auto-logout. The client mirrors the deadline: AuthContext arms a local timer (+250ms grace) and a refresh-401 fires `SESSION_EXPIRED_EVENT` — both paths converge on the same local sign-out. Dedicated E2E: `npm run test:e2e:session`.
- Passwords: bcrypt (cost 10–12). `passwordHash` is `select: false` and stripped by `toSafeUser`. Never logged, never in responses.
- `requireAuth` **re-fetches the user from DB on every request** → bans/deletions/role changes enforce instantly on still-valid tokens.
- `requireAdmin` checks `req.user.role === 'ADMIN'` (403 FORBIDDEN), mounted after `requireAuth`.
- **Enumeration resistance:** unknown email ≡ wrong password (same status/code/message). Ban check runs only AFTER valid credentials (403 ACCOUNT_BANNED).
- **Validation:** shared Yup schema on every request body/params/query via the `validate` middleware — it **replaces `req.body` with the Yup-cast result and strips unknown keys** → role-escalation-by-payload is structurally impossible.
- **NoSQL injection:** Mongoose `sanitizeFilter` is set on the connection (`lib/db.js`). Known trap: object-form `$in` on a scalar path gets defanged → **always use a plain array** for `$in` on scalar paths (e.g. owner-id lists).
- **IDOR:** every mutation re-verifies ownership in the service layer; non-participants get 403 on swap reads; admin routes double-gated.
- **Rate limiting** (`express-rate-limit`, factory in `middleware/rateLimit.js`):
  - `/auth/login` and `/auth/register`: **separate per-IP buckets** (env-overridable), mounted before validation so garbage-payload spam counts.
  - **Per-user write limiter:** 30/min/user shared across item+swap writes; **classify limiter:** separate 10/min/user (paid, latency-bound external call). Mounted AFTER `requireAuth` (user-id keying) and BEFORE `validate`. IPv6-safe `ipKeyGenerator` fallback.
- **Error shape everywhere:** `{ "error": { "code": "MESSAGE" } }` via `AppError(status, code, message)` + global error middleware. Representative codes: `VALIDATION`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `ACCOUNT_BANNED`, `INVALID_REFRESH`, `UNAUTHENTICATED`, `FORBIDDEN`, `RATE_LIMITED`, `ITEM_NOT_FOUND`, `ITEM_NOT_AVAILABLE`, `CONFLICT`, `INVALID_STATE`, `INSUFFICIENT_POINTS`. No stack traces in production.
- Middleware stack: helmet → cors → compression → json → cookieParser → requestLogger (structured JSON, `requestId/method/route/status/durationMs/userId`, secrets redacted recursively).

---

## 8. Swap lifecycle

**Creation (§14.2 rules, all enforced server-side):** requester ≠ owner · target item `APPROVED` · DIRECT_SWAP: offered item owned by requester AND `APPROVED` · POINTS_REDEMPTION: `requester.pointsBalance >= item.pointValue` (else 409 `INSUFFICIENT_POINTS`) · no existing PENDING request from the same requester on the same item · optional `requesterPhone` validated by a 3-layer shared phone validator (strict structure → junk heuristics on the national number → libphonenumber-js reality check, country code required) and stored E.164 · client-sent `status` never survives — creation is always PENDING.

**Acceptance (§5.7 — the concurrency-critical flow):**
1. Start a Mongoose session transaction (with bounded `WriteConflict` retry via `lib/withTransaction.js`).
2. `Item.findOneAndUpdate({ _id, status: 'APPROVED' }, { $set: { status: 'PENDING_TRANSFER' } }, { session })` — the conditional match is the lock. If null → the item was taken concurrently → **abort + 409** (never a stale overwrite).
3. DIRECT_SWAP: same conditional claim on the offered item; then both items swap `ownerId` and go `SWAPPED`.
4. POINTS_REDEMPTION: insert the two ledger docs (−points requester, +points owner) + update both `pointsBalance` caches **in the same transaction**; item → `SWAPPED`, `ownerId` → requester.
5. All other PENDING requests on the now-unavailable item(s) auto-REJECT with a "no longer available" note.
6. Commit. Losing concurrent accepts get a clean 409 — **exactly one winner** (test-enforced with real parallel requests).

**Reject / cancel:** no ownership/points side effects; `requesterPhone` scrubbed (dead consent must not persist); cancel is requester-only pre-accept. **ACCEPTED is terminal:** cancel-after-accept → 409; original-owner reject-after-transfer → 403 (they're no longer the owner of record).

**Contact reveal (accepted-only):** accepted rows attach `contact { name, email, phone }` for BOTH parties (requester's volunteered number + owner's signup phone; emails both ways) via one batched `User.find` — `mailto:`/`tel:` links in the UI. Pending/rejected/cancelled rows carry NO contact. Incoming list is keyed on `participants` (`$and: [participants=me, requester≠me]`, sanitize-safe) so the acceptor never loses their accepted rows after ownership transfer.

**Dispute kit (fraud response — human adjudication, never automation):** either participant of an ACCEPTED swap files `POST /swap-requests/:id/report` (participant-only, accepted-only, one per reporter). Admin resolves via `PATCH /admin/reports/:id` with a REQUIRED ≥10-char resolution note. `REFUND` remedy reverses the ORIGINAL ledger pair (debit `participants[0]`, credit requester) via two append-only `ADJUSTED` docs + cache updates in ONE transaction, **capped at the offender's recoverable balance** (shortfall stated in the note); swap → CANCELLED; report → RESOLVED + AdminAction audit row. `NONE` → DISMISSED, zero ledger effect. The platform NEVER auto-reverses swaps.

---

## 9. AI-assisted listing (the differentiator)

- `POST /api/v1/items/classify` `{ imageUrl }` → `200 { suggestion: { suggestedCategory, suggestedCondition, suggestedPoints, confidence } | null }`.
- **Advisory-only by contract:** EVERY failure (provider throw, timeout, parse error, low confidence < 0.5, no provider configured) returns `200 { suggestion: null }` — never a 500, never a submission blocker. 8s hard timeout (`CLASSIFY_TIMEOUT_MS`); provider call itself 7s.
- **Provider:** Groq (OpenAI-compatible chat.completions, JSON mode with images, temperature 0, image passed BY URL). Model pinned via `GROQ_VISION_MODEL` env (default `qwen/qwen3.8-27b`), behind a pluggable `setProvider` seam for tests.
- **Ownership-scoped (two-tier):** the URL must exist in `images[]` of one of the CALLER's items, OR live under the caller's own Cloudinary folder `rewear/items/{userId}/` (the upload-first flow needs tier 2 — a fresh photo belongs to no item yet). Foreign folders / arbitrary public URLs → 404.
- **Anti-hallucination:** the service recomputes `suggestedPoints` from the shared formula — a model-supplied points value can never reach the economy. Category is constrained to the canonical `ITEM_CATEGORIES` enum; out-of-enum output fails the whole suggestion (falls back to manual entry).
- **Upload-first pipeline:** images upload to Cloudinary (through sharp) as they're picked; a failed upload never discards entered form fields; the item document is only persisted after all uploads succeed (no partial items).

---

## 10. API surface (REST, JSON, prefix `/api/v1`)

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | Yup shared schema; E11000 → 409 EMAIL_TAKEN; optional phone |
| POST | `/auth/login` | — | generic 401; banned → 403 after credential check; rotation |
| POST | `/auth/refresh` | cookie | rotation; replay of rotated cookie → 401 |
| POST | `/auth/logout` | access | 204; server-side session invalidation (hash nulled); idempotent |
| GET | `/auth/me` | access | safe user |
| POST | `/items` | user | multipart/upload-first; status forced PENDING; pointValue derived |
| POST | `/items/classify` | user | ownership-scoped; advisory-only; 10/min/user limiter |
| GET | `/items` | public | filters: `category, size, condition, tags, q, page, pageSize`; non-owners forced APPROVED |
| GET | `/items/:id` | public if APPROVED / owner+admin any | owner attached as separate `owner` field (public fields only: name, avatarUrl, location, createdAt) |
| PATCH | `/items/:id` | owner | only PENDING/APPROVED and no active swap |
| DELETE | `/items/:id` | owner | soft delete → REMOVED; 409 with active swap |
| POST | `/items/:id/swap-requests` | user | `{ type, offeredItemId?, requesterPhone? }` |
| GET | `/swap-requests?direction=incoming\|outgoing` | user | enriched payload (requester name+avatar; item size/condition/thumbnail) — one call, no N+1 |
| GET | `/swap-requests/:id` | participant or admin | 403 for non-participants |
| PATCH | `/swap-requests/:id` | owner (ACCEPT/REJECT) / requester (CANCEL) | §5.7 transaction on ACCEPT |
| POST | `/swap-requests/:id/report` | participant | accepted-only; one per reporter |
| GET | `/users/me/items` | user | ALL statuses (owner manages their PENDING/REJECTED too) |
| GET | `/users/me/points/history` | user | paginated ledger |
| PATCH | `/users/me` | user | **editable profile** — name, optional phone (E.164-validated, '' clears), OPTIONAL password change gated on `currentPassword` re-auth (403 INVALID_CREDENTIALS when wrong); **USER-ONLY: admins get 403 FORBIDDEN (product decision — admins don't self-serve a profile)**; write-limited; shared `profileUpdateSchema`; field whitelist (`PROFILE_EDITABLE_FIELDS`) so role/points/email can never ride in; unknown keys stripped |
| GET | `/admin/items/pending` | admin | moderation queue (duplicate-flag badge via moderationReason) |
| GET | `/admin/items?status=APPROVED\|REMOVED&q=` | admin | **live-monitoring list** — what is publicly visible RIGHT NOW (default APPROVED, newest first) + the REMOVED takedown trail; q searches titles within the selected status |
| PATCH | `/admin/items/:id/moderate` | admin | `{ action: APPROVE\|REJECT\|REMOVE, reason? }` — transition table: APPROVE/REJECT from PENDING only; **REMOVE from PENDING/APPROVED (post-approval takedown, reason REQUIRED)**; SWAPPED/REJECTED are untouchable; conditional update (race-safe 409, plain-array status match) + audit row |
| GET | `/admin/users` | admin | search `q` (name/email, escaped), role/banned filters |
| PATCH | `/admin/users/:id/ban` | admin | `{ banned, reason? }` + audit row |
| GET | `/admin/reports` | admin | dispute queue (populated parties + swap + item) |
| PATCH | `/admin/reports/:id` | admin | resolve/dismiss + remedy + required note |
| GET | `/health` | — | `{ status, db }`; 503 degraded |

---

## 11. Frontend architecture

**Stack:** React 18 + Vite, Tailwind CSS v4 (CSS-first tokens in `styles/index.css`), React Router, TanStack Query (all server state), React Hook Form + the SAME shared Yup schemas the API uses, AuthContext (strict-context convention).

**Routes:** `/` · `/login` · `/register` · `/items` · `/items/:id` · `/items/new` · `/items/:id/edit` · `/dashboard` · `/dashboard/profile` · `/dashboard/items` · `/dashboard/swaps` · `/dashboard/points` · `/admin` (≡ `/admin/items/pending`) · `/admin/live` · `/admin/users` · `/admin/users/:id` · `/admin/reports` · 404 / 403 pages. Route guards redirect unauthenticated users to `/login`; non-admins on admin routes get the Forbidden page.

**Pages:** HomePage (hero + CTAs + **featured items carousel** — SHIPPED, see `FeaturedCarousel` below) · BrowsePage (URL-driven filters: category chips, size, condition, tags, **debounced search-as-you-type 300ms**, pagination; aria-live result counts) · ItemDetailPage (gallery, uploader info, availability, SwapRequestDialog) · ItemFormPage (add/edit: upload-first ImageUploader, AI suggestion prefill with inline loading + "AI suggested" tags — never locked, category dropdown (canonical enum), live point recalc on category/condition change, readOnly pointValue with hint, tags parsed from comma input, delete lives on the edit page) · DashboardPage (profile summary incl. **inline profile editing**, points balance, items overview, swaps card with NEW chip) · MyItemsPage · MySwapsPage (incoming/outgoing tabs, self-explanatory SwapRequestRow cards with plain-language summary sentences, NEW highlights, accepted-only contact card, confirm dialogs) · PointsHistoryPage (paginated ledger) · AdminQueuePage · AdminLiveItemsPage · AdminUsersPage · AdminUserDetailPage · AdminReportsPage · Login/Register (optional phone with consent hint) · NotFound/Forbidden.

**Key components:** `Layout` (skip link, nav with points chip + ambient NEW-swaps badge — both USER-only per the moderator-only contract; admins get Browse · Admin · static name · Logout — ToastProvider mount, SwapArrivalWatcher) · `ItemCard` (photo-first card, primary-image pick, points chip, no-photo fallback) · `StatusBadge` · `SwapRequestDialog` (offer picker filtered to APPROVED own items, optional phone field client-validated with the shared validator, confirm disabled until valid) · `SwapRequestRow` · `ConfirmDialog` (focus trap + focus restore + `confirmDisabled` + `wide`/`hideActions` modes with a ✕ close affordance + aria-busy/describedby) · `AsyncBoundary` (loading/empty/error on EVERY data view; skeleton semantics role=status + aria-live=polite) · `Pagination` · `ToastProvider`/`useToast` (single viewport, aria pattern, injectable ttl, outcome copy in plain language) · `ItemDetailsDialog` (admin read-only item inspection on `ConfirmDialog wide hideActions`; deliberately action-free so a reading mistake can't fire a mutation) · `ReportSwapDialog` · `ImageUploader` · `FeaturedCarousel` (SHIPPED: latest-4 APPROVED items via the public browse endpoint `?page=1&pageSize=4`, zero backend changes; scroll-snap track of real `ItemCard`s, native touch swipe; auto-advance ~5s paused on hover/focus-within, never armed under `prefers-reduced-motion`; OVERFLOW-AWARE controls — track measured in `useLayoutEffect` + re-measured on resize, arrows/dots render only when cards overflow, so desktop's single static row has no inert chrome; skeleton while loading; renders `null` on empty or error; optimistic `setActiveIndex` before `scrollTo` because jsdom/legacy browsers lack `Element.scrollTo`; tests in `featuredCarousel.test.jsx`) · `ProfileSettingsPage` (`/dashboard/profile` — RHF resolving the shared `profileUpdateSchema`; edits name/phone + password change behind a re-auth gate; 403 INVALID_CREDENTIALS maps onto the currentPassword field; success merges the returned safe user into AuthContext via `updateUser` + toast; pristine-form resync uses a synchronous `getValues()` check — NOT `formState.isDirty`, whose async subject stream can wipe fresh keystrokes).

**Hooks/libs:** `useNewSwapRequests` (ONE hook, two modes: AMBIENT navbar/dashboard badge with 60s poll + focus refetch — never writes seen-state; PAGE mode for MySwapsPage with visit-stable snapshot semantics) · `lib/seenRequests.js` (per-user localStorage seen-set, capped, fail-open) · `lib/chime.js` (two-note WebAudio, per-user mute persisted) · `lib/api/*` (one module per resource: auth, items, swaps, users, admin — components never call fetch directly).

**Design & a11y:** sustainability-forward green "brand" palette, photo-first, card-based, 8px spacing; WCAG AA contrast verified by luminance math (custom `stone-450` text token, `brand-700`/`brand-800` button tokens); `:focus-visible` ring; global `prefers-reduced-motion`; every error surface `role=alert`; every form label wired `htmlFor`/`id`; decorative images `alt=""`; mobile-first (header wraps on small screens).

**Privacy rules:** public surfaces (browse, item detail, profiles) expose ONLY name, avatarUrl, location, createdAt. Email, phone, and points balance NEVER appear publicly — contact details are revealed exclusively through the accepted-swap contact card.

---

## 12. Feature inventory (current version — everything below is COMPLETE)

### 12.1 From the problem statement
- Email/password auth (register, login, refresh rotation, logout, protected routes)
- Landing page: intro, three CTAs, **featured items carousel** — SHIPPED: latest 4 approved items (overflow-aware controls; self-hides when nothing is approved)
- User dashboard: profile details (**editable**), points balance, uploaded items overview, ongoing + completed swaps
- Item detail: gallery, description, uploader info, Swap Request / Redeem via Points, availability status
- Add item: image uploads + title/description/category/type/size/condition/tags
- Admin panel: moderation queue (approve/reject with reason), **live-items monitoring** (`/admin/live` — watch everything currently public, REMOVE with mandatory reason, Removed tab = takedown trail), **full item-details dialog on every admin row** (thumbnail-only rows are for triage; Details opens the gallery, specs, description, tags, owner name+email and a link to the full page — `ItemDetailsDialog` on `ConfirmDialog wide hideActions`), item-detail **Admin controls** (remove a live listing from where the admin is looking at it), users management (search/filter/ban), reports console, lightweight oversight

### 12.2 Beyond-spec, shipped
- **Points ledger** (append-only) + cache reconciliation invariant
- **Concurrency-safe swaps** (transactional accept; exactly-one-winner test)
- **AI-assisted listing** (Groq vision → category/condition/points prefill; advisory-only; formula-derived points)
- **Duplicate-image fraud flag** (perceptual hash → moderationReason pre-filled → admin-queue badge)
- **Contact reveal + phone exchange** (accepted-only, both directions, E.164, junk-phone heuristics, scrub on death)
- **Dispute/refund kit** (reports queue, human adjudication, ledger-reversing refund capped at recoverable balance)
- **Search-as-you-type** (300ms debounce, URL contract preserved)
- **NEW-request highlights** (per-user localStorage seen-set) + **ambient navbar badge** + **arrival toast + chime** (baseline semantics: first data pass is never toasted)
- **Unified toast system** for all outcomes
- **Admin is MODERATOR-ONLY in the UI (user decision, mirrors the profile rule):** the navbar hides the points chip, the List-an-Item CTA, and the Dashboard link for ADMINs (participant affordances; ambient NEW-swap badge goes with Dashboard) — admins see Browse · Admin · static name · Logout. Tests pin this nav contract in `auth.test.jsx`. NOTE: UI-only today — the API does not yet 403 admins on `POST /items` or swap creation (server-side enforcement would mirror the profile rule's service-layer pattern).
- **Editable profile (USER-ONLY)** — reached from the CLICKABLE NAVBAR PROFILE (avatar/initial + name → `/dashboard/profile`) and a dashboard "Edit profile" link; edits name, phone (E.164, '' clears), and password (currentPassword re-auth required); validated by the shared `profileUpdateSchema` on BOTH sides; AuthContext gained `updateUser` so the navbar reflects edits instantly. ADMINS are excluded end-to-end: the API 403s them at the service layer, the navbar renders their name as static text (no link), the dashboard hides the Edit link, and direct URL access renders ForbiddenPage — profile self-service is a marketplace-participant feature, and admins are moderators, not participants
- **Saved items / wishlist** — REMOVED (see §16)
- Responsive pass (header wrap, toast viewport) + accessibility pass (contrast by math, focus traps, skip link, reduced-motion)
- Per-user rate limiting on writes; separate classify bucket
- **Playwright E2E journey** (full real-stack: register → list item with real image → admin approves → demo user redeems with phone → owner accepts → item gone from owner dashboard → contact card on accepted row → report surface present)

---

## 13. Testing & quality gates

- **API:** Jest (native ESM — `import { jest } from '@jest/globals'`; `NODE_OPTIONS=--experimental-vm-modules`; testTimeout 60s) + Supertest + `mongodb-memory-server` **replset** (transactions need a replica set; standalone mongod rejects them — and silently commits empty transactions, so topology is asserted, not assumed).
- **Web:** Vitest + React Testing Library (excludes `e2e/**`).
- **E2E:** Playwright, two `webServer` entries (API :4000 with upsert-only fixture script `scripts/e2e-ensure-fixtures.js` — NEVER drops/reseeds the dev DB; Vite :5173 with `/api` proxy so the refresh cookie is first-party).
- **Key test-enforced invariants:** swap-accept concurrency (exactly one 200 + one 409) · ledger↔cache reconciliation · security index suite (IDOR read+write, token forgery with wrong secret, NoSQL-injection login, swap state smuggling) · enumeration resistance · contact reveal both directions + scrubbing · refund full-amount + capped reconciliation · 29-case phone validation matrix · admin route authz matrix.
- **Full gate on every change:** `npm test` · `npm run test:web` · `npm run test:e2e:session` · `npm run lint` · `npm run format:check` · `npm run build` — all green (at Phase 8 close: API 229 / web 155; web is now **208/208** after the admin-nav + featured-carousel additions — run the commands for current counts).
- Test-timing lore: prefer `findBy*` over sync `getBy*`; React 18 schedules via MessageChannel so fake timers are unreliable for setState flushes — inject a short real ttl instead.

---

## 14. Seed & demo data

- `npm run seed` — deterministic, re-runnable (drop-and-reseed the dev DB; refuses in production without `--force`).
- Contents: 1 admin (placeholder credentials documented in `.env.example` comments), demo users with varying balances, `demo@rewear.test` **funded with 120 points via real EARNED ledger entries** (balance always reconciles), items across every category/condition with mixed statuses (PENDING for the admin queue, one REJECTED with reason, one SWAPPED), a few swap requests in various states, and **one intentionally duplicated image pair** to demo the fraud flag live. NOTE: the seed still gives the ADMIN one owned item — if the moderator-only participation rule is ever enforced server-side, move that item to a demo user.
- E2E fixtures are upsert-only and create-only (timestamped identities) so reruns never wipe manual-testing data.

---

## 15. Environment variables

**API** (`apps/api/.env`; `.env.example` documents all): `MONGODB_URI` (Atlas SRV — replica set required for transactions) · `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (min 32 chars, must differ) · `CLOUDINARY_URL` · `GROQ_API_KEY`, `GROQ_VISION_MODEL` (default `qwen/qwen3.8-27b`) · `CLASSIFY_TIMEOUT_MS` · `NODE_ENV`, `PORT` (4000), `CORS_ORIGIN` · `AUTH_RATE_LIMIT_MAX`/`AUTH_RATE_LIMIT_WINDOW_MS` · `WRITE_RATE_LIMIT_MAX` (30/min default), `WRITE_RATE_LIMIT_WINDOW_MS` · `CLASSIFY_RATE_LIMIT_MAX` (10/min default).

**Web** (`apps/web/.env`): `VITE_API_BASE_URL`.

Secrets are never committed; `.env` files are git-ignored (verify with `git check-ignore`).

**Deployment targets (P9):** frontend → Vercel (vercel.json in place) · backend → Railway/Render (plain Node deploy, no Dockerfile) · DB → production Atlas database (separate name/cluster from dev).

---

## 16. Deliberately out of scope — do NOT suggest

- **Public profile pages** (dropped by product decision — owner info appears only inline on item payloads)
- **Location browse filter** (REMOVED by user decision, commit "removed the city searching feature"; `location` survives only as a public owner field on item payloads)
- **Saved items / wishlist** (REMOVED by user decision — docs previously claimed it shipped; no `savedItemIds`, no `/save` endpoints, no `/dashboard/saved` route exist in code. Do not re-add without an explicit ask)
- Real payments / monetary value (points are non-monetary) · shipping/logistics · social login
- Docker / docker-compose (anywhere, ever) · TypeScript · migration frameworks
- In-app messaging, mobile app, geolocation "near me", BullMQ/Redis queues (only if classify latency ever becomes a real problem — it currently runs sub-second)

---

## 17. Open items / next steps

1. **P9 — Deployment:** prod Atlas, backend deploy, frontend deploy, smoke test.
2. **P10 — Demo seed expansion + demo-script rehearsal.**
3. **CI workflow** (`.github/workflows/ci.yml` — lint + tests + build, no service containers) is specced but not yet committed.
4. Parked ideas (not started, do not build unprompted): notification center, admin CSV export, ratings/reputation, "items like this" recommendations.

---

## 18. Codebase conventions & gotchas (obey when writing code)

- **Server-side trust model:** `status`, `ownerId`, `pointValue` are ALWAYS set server-side — the service spreads derived fields AFTER the payload; client-smuggled values are stripped/ignored, not errored. Same pattern for swap status (always PENDING at creation).
- `sanitizeFilter` defangs object-form `$in` on scalar paths → use **plain arrays**.
- Mongoose `create()` with an array + session requires `ordered: true`.
- Transactions need a replica set: Atlas M0 in dev, `MongoMemoryReplSet` in tests.
- `config/env.js` SNAPSHOTS `process.env` at import — in tests, mutate the imported env object, not `process.env`.
- ALL schemas/enums/`pointsFormula` come from `@rewear/shared-schemas` — never duplicate them in app code; web and api share the exact validation rules.
- Rate limiters mount AFTER `requireAuth` (user keying) and BEFORE `validate` (spam counts).
- `pointsBalance` is a cache — every change writes a ledger doc in the same transaction; never delete ledger rows on shared fixtures without restoring caches (`reconcileUserPoints`).
- Errors: `AppError(status, code, message)` → `{ error: { code, message } }`; 4xx must never leak stack traces.
- Frontend: React Query invalidation keying — swaps invalidate under the `['swap-requests']` prefix so navbar badge refetches cascade; every data view goes through `AsyncBoundary` with a contextual empty state + CTA; mutation errors render `role=alert` with dialogs kept open; outcomes go through `useToast`.
- Contact reveal is accepted-only; `requesterPhone` scrubbed on REJECT/CANCEL; never render email/phone/points on public surfaces.
- Every change must pass the full gate: API tests, web tests, lint, format, build (and E2E when flows are touched).
- Schema changes are additive (pre-launch, no migration framework); one-off scripts go under `apps/api/scripts/`.

---

## 19. Status summary

Phases 0–8 of the implementation plan are **100% complete** (init → architecture → database → auth → core backend → core frontend → AI classification → cross-cutting states → testing hardening), plus user-requested scope additions (dispute kit, contact reveal + phone validation) and recent features (**featured carousel — shipped as latest-4 with overflow-aware controls, editable profile, fixed session window with client auto-logout, admin moderator-only nav**). The location browse filter and saved-items/wishlist features were REMOVED by user decision (§16). Remaining: deployment (P9) and demo-seed expansion (P10, incl. making the 25-point signup grant ledger-backed). The former admin-REMOVE gap is CLOSED: admins can strike live listings (REMOVE action, reason mandatory, audit row, `/admin/live` monitoring page + item-detail Admin controls). Full test suites, lint, format, and build are green.
