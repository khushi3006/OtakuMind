# Persistent Shared Airing Cache — Design

**Date:** 2026-06-06
**Status:** Approved (ready for implementation plan)
**Repos touched:** `OtakuMind` (web/backend, commits authored by khushi), `otakumind-mobile` (commits authored by shevilll)

## Problem

Next-episode data (the real episode number + exact air time) is fetched live from
AniList on every list read and cached only in a **module-level `Map`** in
`lib/anilist.ts`. On Vercel's serverless runtime that map is **per-instance and
ephemeral**: cold starts begin empty and concurrent instances don't share it, so
the cache's hit rate in production is low. The same is true of the Jikan
franchise-relations and search caches. Consequences:

- **AniList rate-limit exposure.** A cold `GET /api/anime` re-fetches *all* of a
  user's airing shows from AniList. Many dashboards loading near each other can
  approach AniList's ~90 req/min (30 when degraded). The reassuring "stays well
  under the limit" comments in the code do not hold once instances are ephemeral.
- **A 40s blocking sync.** `POST /api/anime/sync-airing` loops every incomplete
  `malId`-linked anime at 400 ms spacing against Jikan — user-triggered and
  blocking (~40 s for 100 shows).
- **Redundant work.** 500 users tracking the same show each trigger their own
  AniList fetches even though next-episode data is identical per `malId`.

The next-episode number and air time are **global per `malId`** — they do not vary
by user. So the fix is to compute them **once per show per episode** and persist
them in shared, durable storage.

## Goals

1. One AniList/Jikan call per `malId` regardless of how many users track it.
2. Durable across serverless instances (survives cold starts).
3. Freshness that tracks episode air times — "refresh once the episode airs" —
   **without** depending on cron frequency (Vercel Hobby caps each cron at once
   per day).
4. Instant, non-blocking "add anime"; next-episode badge fills in moments later.
5. Replace the manual 40s "Sync Schedules" loop with automatic background refresh.
6. **No API contract change** so web and mobile stay in sync with zero client
   read-path changes.

## Non-goals

- The broader web → React Query refactor (separate scope item).
- Generic DB index/projection quick-wins (separate scope item), except the
  indexes this feature introduces on `AiringCache`.
- Changing the franchise-relations or Jikan-search caches (separate concern).

## Key platform facts

- **Next.js 16 / React 19.** `after()` (from `next/server`) lets a route return a
  response and then run work — used to refresh stale cache entries off the request
  path so reads stay fast and the next reader gets warm data.
- **Vercel Hobby cron:** up to 100 cron jobs/project but each runs **at most once
  per day** (trigger time can drift ~1h). A daily cron is therefore only a
  pre-warm/cleanup; intraday freshness comes from the on-read `after()` refresh.
- **Prisma client** is generated to the custom path `prisma/generated/client`
  (`@/prisma/generated/client`); run `npx prisma generate` after schema changes.
- **Dual migration mechanism** in this repo: a formal Prisma migration **plus** an
  idempotent raw-SQL `tsx` mirror script (see `CLAUDE.md` → Migrations).

## Architecture

### 1. Data model — new `AiringCache` table

Keyed by `malId` (global, user-independent). Single source of truth for both
AniList and Jikan-derived airing data.

```prisma
model AiringCache {
  malId             Int      @id        // MAL id — the global key
  nextEpisode       Int?                // AniList: next episode number
  nextEpisodeAt     Int?                // AniList: exact air time (unix seconds, UTC)
  broadcastDay      String?             // Jikan: weekly broadcast day
  broadcastTime     String?             // Jikan: JST time
  broadcastTimezone String?
  broadcastString   String?
  airingStart       String?
  releaseStatus     String   @default("unknown") // "releasing" | "finished" | "unknown"
  syncedAt          DateTime @default(now())
  @@index([releaseStatus, nextEpisodeAt]) // cron: "what just aired / needs refresh"
  @@index([syncedAt])                     // cron: oldest-first staleness sweep
}
```

The existing `broadcast*` / `airing*` columns on `Anime` are **kept as dormant
legacy** (non-destructive — no data dropped). The hot path stops reading/writing
them; enrichment comes from `AiringCache`.

### 2. Refresh module — `lib/airing-cache.ts`

Replaces the in-memory `Map` in `lib/anilist.ts`. The AniList GraphQL query itself
(`queryAniList`) is reused/moved; only the cache backing store changes.

- **`getAiringForMalIds(malIds): { fresh: Map<number, AiringInfo>, stale: number[] }`**
  Reads `AiringCache` rows. A row is **stale** when (same rule as today's
  `isFresh`, now durable):
  - the row is missing, OR
  - `nextEpisodeAt * 1000 <= now` (episode aired → next number rolled over), OR
  - `syncedAt` older than a TTL safety net (~12 h).
- **`refreshAniList(malIds)`** — batched AniList query (≤50 ids/req), upserts rows
  (`nextEpisode`, `nextEpisodeAt`, `releaseStatus`, `syncedAt`). Fast + batched;
  used on read (via `after()`) and by the cron.
- **`refreshBroadcast(malIds)`** — throttled Jikan per-id (≥350 ms spacing, 429
  retry), upserts broadcast fields. Slow; used **only on add and in the daily
  cron**, never on read.

**Design split:** AniList (next-ep number, changes weekly) refreshes often and
batched; Jikan (broadcast day/time, rarely changes) only on add + daily cron. This
keeps the read path cheap.

### 3. Read path — `enrichWithAiring` reimplemented

Signature and output shape **unchanged** — still attaches `nextEpisode` /
`nextEpisodeAt` to each airing, `malId`-linked row. Internally:

1. `getAiringForMalIds` for the airing rows' `malId`s.
2. Attach fresh values.
3. If any `stale`, schedule `after(() => refreshAniList(stale))` so the response
   returns immediately and the next reader is warm.

Because the contract is unchanged, **`GET /api/anime`, `GET /api/anime/popular-airing`,
and `GET /api/users/[username]/anime` need no other changes, and web + mobile read
paths need zero changes.**

### 4. Add path & removal of the blocking sync

- **`POST /api/anime`** — response unchanged. After the row is created, schedule
  `after(() => { refreshAniList([malId]); refreshBroadcast([malId]); })` to
  populate `AiringCache`. Non-blocking → instant add.
- **`POST /api/anime/sync-airing`** — the 40s Jikan loop is **deleted**. To avoid
  client 404s during rollout the route is reduced to a thin, fast handler that
  schedules a cache refresh for the caller's incomplete `malId`s and returns
  immediately; it can be removed entirely once both clients ship without the
  button.

### 5. Vercel cron — `app/api/cron/refresh-airing/route.ts`

One **daily** cron in `vercel.json`, secured by `CRON_SECRET`
(`Authorization: Bearer <secret>`). Each run:

1. `refreshAniList` for all `releaseStatus = 'releasing'` rows (a few 50-id batches
   — trivially within AniList limits).
2. `refreshBroadcast` for rows missing broadcast data or releasing, **oldest
   `syncedAt` first**, within the function time budget; remaining rows are picked
   up on the next daily run.
3. Mark shows AniList reports as ended → `releaseStatus = 'finished'`.

Cron registers automatically from `vercel.json` on deploy (no CLI needed). The
once-a-day Hobby cap is acceptable because intraday freshness is handled by the
on-read `after()` refresh.

**`maxDuration`:** set on the cron route within Hobby's allowance; the Jikan loop
is bounded so a single run never exceeds it (paging by `syncedAt` across days).

### 6. Mobile (`otakumind-mobile`, author: shevilll)

- Reads: no change.
- `useCreateAnime`: optimistic insert at top of the Watching list; next-episode
  badge renders a small shimmer while `nextEpisode` is null. One short delayed
  refetch (~1.5 s) after a successful create catches the server-warmed cache; if
  still empty the badge gracefully collapses.
- Remove the "Sync Schedules" button and its `syncAiring` call.

### 7. Web (`OtakuMind`, author: khushi)

- Reads: no change (server-side enrichment swap is transparent).
- Remove the "Sync Schedules" button on the airing-schedule page.

## Data flow (happy path)

```
Add airing anime
  POST /api/anime  ──(create row, return 201 immediately)──▶ client optimistic insert
        └─ after(): refreshAniList([malId]) + refreshBroadcast([malId]) → upsert AiringCache

List read
  GET /api/anime ──▶ enrichWithAiring
        ├─ getAiringForMalIds → fresh values from AiringCache (DB only, fast)
        ├─ attach nextEpisode/nextEpisodeAt → return response
        └─ after(): refreshAniList(stale)  (warms cache for next reader)

Daily cron (pre-warm/cleanup)
  /api/cron/refresh-airing ──▶ refreshAniList(all releasing) + refreshBroadcast(oldest) + mark finished
```

## Error handling

- **Read path never throws.** On AniList/Jikan failure, serve the last cached value
  (even if stale); missing entries degrade to `nextEpisode: null` exactly as today.
- **`after()` and cron failures** are logged and swallowed — they never affect the
  user response.
- **Cron auth:** reject any request whose `Authorization` header ≠
  `Bearer ${CRON_SECRET}` with 401.

## Migration plan

1. Add the `AiringCache` model to `prisma/schema.prisma`.
2. Create a formal Prisma migration under `prisma/migrations/`.
3. Write an idempotent raw-SQL `tsx` mirror script (`CREATE TABLE IF NOT EXISTS`,
   guarded indexes) using `lib/db` (so the Neon/DNS workaround applies), mirroring
   the existing `scripts/migrate-*.ts` pattern; run against dev and prod Neon
   branches; `npx prisma migrate resolve --applied <name>` to keep history
   consistent.
4. `npx prisma generate` (custom client path).
5. Add `CRON_SECRET` to the Vercel project env (dashboard steps provided to the
   user, since the Vercel CLI is not linked to khushi's account).

## Testing / verification

No test framework is configured. Verification:

- A `tsx` script (`scripts/verify-airing-cache.ts`) that calls `refreshAniList` /
  `refreshBroadcast` for a few known `malId`s and dumps the resulting rows.
- Manual: add an airing show → confirm the badge fills within ~1–2 s; reload the
  list → confirm no AniList call when fresh (log instrumentation); hit
  `/api/cron/refresh-airing` locally with the secret → confirm rows update and
  finished shows are marked.

## Rollout / deployment

- Ship the backend (migration + `lib/airing-cache.ts` + route changes + `vercel.json`
  cron + cron route) to the `OtakuMind` repo on `main`, authored by khushi, to
  production. Provide dashboard steps to set `CRON_SECRET` and verify the job under
  **Project → Cron Jobs**.
- Ship the mobile changes (optimistic create + badge shimmer + button removal) to
  `otakumind-mobile`, authored by shevilll.

## Open decisions (resolved)

- **Keep `Anime.broadcast*` columns dormant** rather than migrate them out —
  non-destructive, lowest risk.
- **Mobile badge pop-in via one short delayed refetch** after create — keeps `POST`
  non-blocking while still feeling immediate.
