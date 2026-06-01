# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ The directive above is not boilerplate. This project runs **Next.js 16** (App Router) with **React 19**. APIs and conventions differ from older training data — consult `node_modules/next/dist/docs/01-app/` before writing routing, caching, or data-fetching code. Note that `params` in dynamic route handlers is a `Promise` and must be awaited (see `app/api/anime/[id]/route.ts`).

## Commands

```bash
npm run dev      # Next dev server at http://localhost:3000
npm run build    # Production build
npm run start    # Serve the production build
npm run lint     # ESLint (eslint-config-next, flat config in eslint.config.mjs)
```

There is **no test framework** configured. Standalone maintenance scripts are run with `tsx` (not registered as npm scripts):

```bash
npx tsx scripts/<name>.ts        # e.g. scripts/migrate-db.ts, scripts/seed.ts
```

`scripts/` is excluded from TypeScript checking (`tsconfig.json`), so it does not follow the same strictness as app code.

### Prisma

The Prisma client is generated to a **custom path** (`prisma/generated/client`), not the default `@prisma/client`. App code imports it via the `@/prisma/generated/client` alias. After changing `prisma/schema.prisma`, run `npx prisma generate`.

## Environment

- `DATABASE_URL` — PostgreSQL (Neon) connection string. Required. (`.env`, `.env.development`, `.env.production`)
- `JWT_SECRET` — HMAC key for session tokens. Has an insecure hardcoded fallback in `lib/jwt.ts`; set it explicitly in any real environment.

## Architecture

OtakuMind is a multi-user anime watch tracker with a social follow layer: each account owns its own lists, and users can follow others to browse their (public) lists and copy anime into their own. Pages are **client components** (`"use client"`) that call internal API route handlers; the route handlers own all DB access and auth enforcement. There is no server-component data fetching.

### Data layer (`lib/db.ts`)

Prisma talks to Neon over WebSockets via `@prisma/adapter-neon` (the `driverAdapters` preview feature). The client is memoized on `globalThis` in non-production. In development, `lib/db.ts` also patches `dns.lookup` to resolve `*.neon.tech` through Google DNS (8.8.8.8) — a workaround for ISPs that block Neon hostnames. Do not remove this without understanding why local connections fail.

### Auth (`lib/auth.ts`, `lib/jwt.ts`)

Stateless JWT sessions stored in an httpOnly cookie named `session` (7-day expiry).

- `lib/jwt.ts` uses only Web Crypto (HS256) — **no Node/Next imports** — so it stays Edge-runtime compatible. Keep it that way.
- Passwords are pbkdf2 (`sha512`, 10k iterations), stored as `salt:hash`.
- **Edge gating lives in `proxy.ts`** (Next 16's renamed middleware — the function is exported as `proxy`, not `middleware`). It redirects logged-in users away from `/login`/`/signup`, redirects anonymous users away from protected pages (`PROTECTED_PAGES`: `/`, `/airing-schedule`, `/original-list`, `/users`), and 401s any `/api/*` route except `/api/auth/*`. **This is defense-in-depth, not a substitute:** every protected API route must STILL call `getSession(request)` and enforce ownership itself (the proxy only checks that _a_ session exists, not that the row belongs to the caller). Add new protected pages to `PROTECTED_PAGES`. Client-side, the `Navbar` polls `/api/auth/me` on each navigation to gate UI.

### Anime model & "season grouping"

`lib/normalize.ts` derives `normalizedName` + `season` from a raw title (stripping "Season N", "Part N", roman numerals, OVA/movie markers, etc.) so different seasons of the same show collapse to one normalized name. Uniqueness is enforced per user via `@@unique([userId, normalizedName, season])`. Duplicate detection on create (`POST /api/anime`) checks both `malId` and `(normalizedName, season)`.

Status values are the strings `"incomplete"` (= "Currently Watching" in the UI), `"completed"`, and `"dropped"` — see `STATUS_MAP` in `app/page.tsx`. A `season` of `99` renders as "Final Season". `type` is `"TV" | "Movie" | "OVA" | "Special"`; movies force `episodesWatched`/`totalEpisodes` to 0.

### Watch-order concurrency (the trickiest part — `lib/watch-order.ts`)

`watchOrder` is a **1-based contiguous integer ranking** maintained only for `incomplete` anime (the drag-and-drop "Currently Watching" list, powered by `@hello-pangea/dnd`). Any operation that touches it must keep the sequence dense and gap-free:

- Creating an incomplete anime increments everyone else's `watchOrder` (insert at top).
- Moving an anime out of `incomplete` decrements rows that were after it; moving in increments all existing rows.
- Deleting an incomplete anime decrements rows after it.

All such mutations run inside `db.$transaction(...)` wrapped by `withDeadlockRetry` (`lib/deadlock-retry.ts`, retries on Postgres `40P01` / lost-transaction errors) with `WATCH_ORDER_TRANSACTION_OPTIONS` (15s timeouts). Rows are locked with raw `SELECT ... FOR UPDATE` ordered by `id` to avoid deadlocks. `PUT /api/anime/reorder` applies a batch of `{id, watchOrder}` then calls `normalizeWatchingOrder` to re-densify. **Preserve the lock-ordering and the transaction wrapper when editing these flows.**

The route handlers also defensively catch "Unknown argument `completedAt`/`droppedAt`" Prisma errors and retry without those fields — a guard for environments where the deployed DB predates those columns. Keep this fallback if you touch create/update.

### External data: Jikan API

- `GET /api/search` proxies `api.jikan.moe/v4/anime` for autocomplete, with a 30-minute in-memory `Map` cache and stale-cache fallback on upstream errors/timeouts.
- `POST /api/anime/sync-airing` refreshes broadcast info for the user's incomplete, `malId`-linked anime, throttled to respect Jikan rate limits (400ms spacing, 429 retry).
- `lib/airing-utils.ts` converts Japan (JST) broadcast day/time to UTC for countdowns and to **IST (UTC+5:30)** for the weekly schedule display — this app assumes an India-based viewer. Times come in as JST strings from Jikan.

### Social / follow layer (`Follow` model, `lib/username.ts`)

`User` has a unique public `username` (handle), optional `bio`, and `isPublic` (default `true`). The `Follow` join table is a directed edge `followerId → followingId` with `@@unique([followerId, followingId])` and cascade delete on both FKs (deleting a user removes their follows in both directions). Following is **instant** (no approval) and idempotent (`POST /api/users/[username]/follow` uses `upsert`).

- Usernames: lowercase `[a-z0-9_]{3,20}`. `lib/username.ts` has `slugifyUsername`, `isValidUsername`, and `findAvailableUsername` (used to auto-generate at signup when none is supplied, and to backfill existing users). The `username` is in the JWT payload going forward, but `GET /api/auth/me` reads fresh from the DB so sessions issued before the column existed still resolve it.
- Visibility: a profile's lists are viewable if `isSelf || owner.isPublic`. Following does **not** gate viewing — public lists are visible to any logged-in user; private lists are owner-only. `GET /api/users/[username]/anime` enforces this (403 if private and not self) and flags each anime with `inMyList` (matched by `malId` or `normalizedName`+`season` against the viewer's library).
- "Add to my list" from another user's profile is a **copy** — the client just calls the normal `POST /api/anime`; it never mutates the source user's rows.
- `lib/api-error.ts` (`errorMessage`/`errorCode`) is the typed alternative to `catch (e: any)` used by the social routes.

### Migrations

Two migration mechanisms coexist:

1. Standard Prisma migrations in `prisma/migrations/`.
2. Hand-written raw-SQL scripts (`scripts/migrate-db.ts`, `scripts/finalize-db.ts`, `scripts/migrate-data.ts`, `scripts/add-social-schema.ts`) run via `tsx`. They use the app's `lib/db` connection (so the Neon/DNS workaround applies — more reliable locally than the Prisma CLI). `add-social-schema.ts` added the username/bio/isPublic columns + `Follow` table and backfilled usernames; it is idempotent (`ADD COLUMN IF NOT EXISTS`, guarded constraints) and uses constraint/index names matching what Prisma generates. After applying such a script, mirror it with a formal migration folder under `prisma/migrations/` and run `npx prisma migrate resolve --applied <name>` so `prisma migrate` history stays consistent.

### Routes overview

- Pages: `/` (dashboard with watching/completed/dropped tabs), `/airing-schedule`, `/original-list`, `/users` (discover people), `/users/[username]` (public profile + read-only list browser), `/login`, `/signup`, `/forgot-password`.
- API: `app/api/anime` (list/create), `anime/[id]` (update/delete), `anime/reorder`, `anime/export` (Excel via `exceljs`), `anime/sync-airing`, `anime/popular-airing`, `auth/{login,signup,logout,me,change-password}`, `search`, `stats`. Social: `users/search`, `users/me` (PUT profile edit), `users/[username]` (profile), `users/[username]/anime`, `users/[username]/follow` (POST/DELETE), `users/[username]/{followers,following}`. `app/api/seed` and `app/api/test` are dev-only.

### Styling

Tailwind CSS v4 via `@tailwindcss/postcss` (`postcss.config.mjs`); global styles and CSS custom properties (`--accent-color`, `--bg-color`, etc.) live in `app/globals.css`. Icons are `lucide-react`. Shared UI primitives: `components/{Modal,Toast,Navbar,Logo,FollowButton,UserCard}.tsx`. Social UI styles are appended at the end of `app/globals.css` (`.user-card`, `.follow-btn`, `.profile-*`, `.poster-*`) and reuse the existing design tokens.
