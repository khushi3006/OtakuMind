# Persistent Shared Airing Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move next-episode/broadcast enrichment from an ephemeral per-instance in-memory `Map` to a shared `malId`-keyed `AiringCache` table, refreshed lazily on read via `after()` and pre-warmed by a daily Hobby-compatible cron, with an instant non-blocking "add anime".

**Architecture:** A new `AiringCache` table (keyed by global `malId`) is the single source of truth for AniList next-episode data and Jikan broadcast data. `lib/airing-cache.ts` owns reads (`getAiringForMalIds`) and refreshes (`refreshAniList` batched; `refreshBroadcast` throttled). `enrichWithAiring` and `/api/anime/popular-airing` read the cache and schedule background `after()` refreshes for stale entries. `POST /api/anime` schedules an `after()` populate. The 40s `sync-airing` loop is removed; a daily cron pre-warms. The API response contract is unchanged, so web/mobile read paths don't change.

**Tech Stack:** Next.js 16 (App Router, `after()` from `next/server`), React 19, Prisma (custom client path `@/prisma/generated/client`), Neon Postgres, TanStack React Query (mobile), Expo SDK 56 (mobile).

**Repos / commit authorship:**
- Backend tasks (1–9): `OtakuMind` repo, branch `main`, commits authored by **Khushi Kumari <kk4827182@gmail.com>** (already the repo's git identity).
- Mobile tasks (10–11): `otakumind-mobile` repo, commits authored by **shevilll** (the repo's own git identity).

**Testing reality:** This repo has **no test framework** (`CLAUDE.md`). "Verify" steps therefore use `npm run build` / `npx tsc --noEmit`, an executable `tsx` verification script, and explicit manual checks — not a unit-test runner. Do not invent a test runner.

---

## File Structure

**Backend (`OtakuMind/`):**
- Create: `prisma/migrations/<timestamp>_add_airing_cache/migration.sql` — formal Prisma migration.
- Create: `scripts/migrate-add-airing-cache.ts` — idempotent raw-SQL mirror (run via `tsx`).
- Modify: `prisma/schema.prisma` — add `AiringCache` model.
- Create: `lib/airing-cache.ts` — cache read/refresh module (owns AniList query + Jikan broadcast fetch + staleness rule).
- Modify: `lib/anilist.ts` — reimplement `enrichWithAiring` on top of `lib/airing-cache.ts`; drop the in-memory `Map` and `fetchAniListAiring`.
- Modify: `app/api/anime/popular-airing/route.ts` — read cache instead of calling AniList live.
- Modify: `app/api/anime/route.ts` — `POST` schedules an `after()` cache populate.
- Modify: `app/api/anime/sync-airing/route.ts` — replace the 40s loop with a fast `after()` trigger.
- Create: `app/api/cron/refresh-airing/route.ts` — daily cron handler (CRON_SECRET-guarded).
- Create: `vercel.json` — registers the daily cron.
- Create: `scripts/verify-airing-cache.ts` — manual verification helper.
- Modify: the web airing-schedule page — remove the "Sync Schedules" button.

**Mobile (`otakumind-mobile/`):**
- Modify: `src/api/anime.ts` — optimistic insert in `useCreateAnime` + delayed refetch.
- Modify: `src/api/airing.ts` — remove `useSyncAiring`.
- Modify: the airing tab screen + the next-episode badge — remove the sync button; show a shimmer while `nextEpisode` is null.

---

## Task 1: Add the `AiringCache` model + migration

**Files:**
- Modify: `prisma/schema.prisma` (after the `Anime` model, around line 116)
- Create: `prisma/migrations/<timestamp>_add_airing_cache/migration.sql`
- Create: `scripts/migrate-add-airing-cache.ts`

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Append after the `Anime` model (after line 115):

```prisma
/// Shared, user-independent cache of airing data keyed by MAL id.
/// next-episode fields come from AniList; broadcast fields from Jikan.
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

  @@index([releaseStatus, nextEpisodeAt])
  @@index([syncedAt])
}
```

- [ ] **Step 2: Write the idempotent raw-SQL mirror script**

Create `scripts/migrate-add-airing-cache.ts` (mirrors the pattern in `scripts/migrate-add-season-part.ts`; uses `lib/db` so the Neon/DNS workaround applies):

```ts
import { db } from '../lib/db';

async function main() {
  console.log('Creating AiringCache table (idempotent)…');
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AiringCache" (
      "malId" INTEGER PRIMARY KEY,
      "nextEpisode" INTEGER,
      "nextEpisodeAt" INTEGER,
      "broadcastDay" TEXT,
      "broadcastTime" TEXT,
      "broadcastTimezone" TEXT,
      "broadcastString" TEXT,
      "airingStart" TEXT,
      "releaseStatus" TEXT NOT NULL DEFAULT 'unknown',
      "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiringCache_releaseStatus_nextEpisodeAt_idx" ON "AiringCache" ("releaseStatus", "nextEpisodeAt");`
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiringCache_syncedAt_idx" ON "AiringCache" ("syncedAt");`
  );
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Apply the schema to the dev database**

Run: `npx prisma migrate dev --name add_airing_cache`
Expected: a new folder `prisma/migrations/<timestamp>_add_airing_cache/` is created, the migration applies to the dev Neon branch, and the Prisma client regenerates to `prisma/generated/client`.

If `prisma migrate dev` fails to connect locally (Neon/DNS), fall back to the mirror script: `npx tsx scripts/migrate-add-airing-cache.ts`, then `npx prisma generate`, then create the migration folder manually and run `npx prisma migrate resolve --applied add_airing_cache`.

- [ ] **Step 4: Verify the client has the model**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). Then in a node/tsx REPL or by grepping the generated client, confirm `db.airingCache` exists:
Run: `grep -r "airingCache" prisma/generated/client/index.d.ts | head -1`
Expected: a match for the `airingCache` delegate.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma scripts/migrate-add-airing-cache.ts prisma/migrations
git commit -m "feat(db): add shared AiringCache table keyed by malId"
```

---

## Task 2: Create the cache module `lib/airing-cache.ts`

**Files:**
- Create: `lib/airing-cache.ts`

- [ ] **Step 1: Write the module**

Create `lib/airing-cache.ts` with the complete contents:

```ts
import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';

/** Next-airing-episode info as surfaced to callers. */
export interface AiringInfo {
  episode: number;
  airingAt: number;
}

/** A cache row's display-relevant fields. */
export interface AiringRow {
  nextEpisode: number | null;
  nextEpisodeAt: number | null;
  broadcastDay: string | null;
  broadcastTime: string | null;
  broadcastTimezone: string | null;
  broadcastString: string | null;
  airingStart: string | null;
}

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const FETCH_TIMEOUT = 4000;
const ANILIST_BATCH = 50;
const STALE_TTL_MS = 1000 * 60 * 60 * 12; // 12h safety net
const JIKAN_SPACING_MS = 350; // stay under Jikan's ~3 req/s

const ANILIST_QUERY = `
  query ($ids: [Int]) {
    Page(perPage: 50) {
      media(idMal_in: $ids, type: ANIME) {
        idMal
        status
        nextAiringEpisode { episode airingAt }
      }
    }
  }
`;

function mapStatus(s: string): string {
  if (s === 'FINISHED' || s === 'CANCELLED') return 'finished';
  return s ? 'releasing' : 'unknown';
}

interface AniListMedia {
  idMal: number;
  status: string;
  next: AiringInfo | null;
}

async function queryAniListBatch(ids: number[]): Promise<AniListMedia[]> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { ids } }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`AniList API returned status ${res.status}`);
  const json = await res.json();
  const media = json?.data?.Page?.media ?? [];
  const out: AniListMedia[] = [];
  for (const m of media) {
    if (!m?.idMal) continue;
    const n = m.nextAiringEpisode;
    const next =
      n && typeof n.episode === 'number' && typeof n.airingAt === 'number'
        ? { episode: n.episode, airingAt: n.airingAt }
        : null;
    out.push({ idMal: m.idMal, status: m.status ?? '', next });
  }
  return out;
}

/**
 * Reads the cache for the given MAL ids. Returns the rows it has (for display)
 * and the ids whose AniList data is stale/missing (so the caller can schedule a
 * background refresh). Staleness = missing row, episode already aired, or older
 * than the TTL safety net. Stale rows still return their last known value so the
 * UI never blanks out while a refresh runs.
 */
export async function getAiringForMalIds(
  malIds: number[]
): Promise<{ rows: Map<number, AiringRow>; stale: number[] }> {
  const ids = [...new Set(malIds.filter(Boolean))];
  const rows = new Map<number, AiringRow>();
  const stale: number[] = [];
  if (ids.length === 0) return { rows, stale };

  const found = await db.airingCache.findMany({ where: { malId: { in: ids } } });
  const byMal = new Map(found.map((r) => [r.malId, r]));
  const now = Date.now();

  for (const id of ids) {
    const r = byMal.get(id);
    if (!r) {
      stale.push(id);
      continue;
    }
    rows.set(id, {
      nextEpisode: r.nextEpisode,
      nextEpisodeAt: r.nextEpisodeAt,
      broadcastDay: r.broadcastDay,
      broadcastTime: r.broadcastTime,
      broadcastTimezone: r.broadcastTimezone,
      broadcastString: r.broadcastString,
      airingStart: r.airingStart,
    });
    const expired = now - r.syncedAt.getTime() >= STALE_TTL_MS;
    const aired = r.nextEpisodeAt != null && r.nextEpisodeAt * 1000 <= now;
    const noEpisode = r.nextEpisode == null || r.nextEpisodeAt == null;
    if (expired || aired || noEpisode) stale.push(id);
  }
  return { rows, stale };
}

/**
 * Refreshes AniList next-episode data for the given MAL ids (batched, ≤50/req)
 * and upserts the cache rows. Returns the number of rows touched. Never throws.
 */
export async function refreshAniList(malIds: number[]): Promise<number> {
  const ids = [...new Set(malIds.filter(Boolean))];
  let updated = 0;
  for (let i = 0; i < ids.length; i += ANILIST_BATCH) {
    const batch = ids.slice(i, i + ANILIST_BATCH);
    let media: AniListMedia[];
    try {
      media = await queryAniListBatch(batch);
    } catch (e) {
      console.warn(`[airing-cache] AniList batch failed: ${errorMessage(e)}`);
      continue;
    }
    const byMal = new Map(media.map((m) => [m.idMal, m]));
    await Promise.all(
      batch.map(async (malId) => {
        const hit = byMal.get(malId);
        const releaseStatus = hit ? mapStatus(hit.status) : 'unknown';
        const next = hit?.next ?? null;
        await db.airingCache.upsert({
          where: { malId },
          create: {
            malId,
            nextEpisode: next?.episode ?? null,
            nextEpisodeAt: next?.airingAt ?? null,
            releaseStatus,
          },
          update: {
            nextEpisode: next?.episode ?? null,
            nextEpisodeAt: next?.airingAt ?? null,
            releaseStatus,
            syncedAt: new Date(),
          },
        });
        updated++;
      })
    );
  }
  return updated;
}

let lastJikanCall = 0;
async function throttleJikan(): Promise<void> {
  const wait = JIKAN_SPACING_MS - (Date.now() - lastJikanCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastJikanCall = Date.now();
}

/**
 * Refreshes Jikan broadcast data for the given MAL ids (throttled, one request
 * each) and upserts the cache rows. Slow — call only on add and from the daily
 * cron, never on the read path. Returns rows touched. Never throws.
 */
export async function refreshBroadcast(malIds: number[]): Promise<number> {
  const ids = [...new Set(malIds.filter(Boolean))];
  let updated = 0;
  for (const malId of ids) {
    try {
      await throttleJikan();
      let res = await fetch(`https://api.jikan.moe/v4/anime/${malId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000));
        res = await fetch(`https://api.jikan.moe/v4/anime/${malId}`, {
          signal: AbortSignal.timeout(5000),
        });
      }
      if (!res.ok) continue;
      const json = await res.json();
      const d = json?.data;
      if (!d) continue;
      const b = d.broadcast || {};
      await db.airingCache.upsert({
        where: { malId },
        create: {
          malId,
          broadcastDay: b.day || null,
          broadcastTime: b.time || null,
          broadcastTimezone: b.timezone || null,
          broadcastString: b.string || null,
          airingStart: d.aired?.from || null,
          releaseStatus: d.airing ? 'releasing' : 'unknown',
        },
        update: {
          broadcastDay: b.day || null,
          broadcastTime: b.time || null,
          broadcastTimezone: b.timezone || null,
          broadcastString: b.string || null,
          airingStart: d.aired?.from || null,
          syncedAt: new Date(),
        },
      });
      updated++;
    } catch (e) {
      console.warn(`[airing-cache] Jikan ${malId} failed: ${errorMessage(e)}`);
    }
  }
  return updated;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (If `db.airingCache` is unknown, Task 1 Step 3/4 didn't regenerate the client — run `npx prisma generate`.)

- [ ] **Step 3: Commit**

```bash
git add lib/airing-cache.ts
git commit -m "feat: airing-cache module (read + AniList/Jikan refresh)"
```

---

## Task 3: Reimplement `enrichWithAiring` on the cache

**Files:**
- Modify: `lib/anilist.ts` (replace entire file)

- [ ] **Step 1: Replace `lib/anilist.ts` with the cache-backed version**

Overwrite the whole file:

```ts
import { after } from 'next/server';
import { errorMessage } from '@/lib/api-error';
import { getAiringForMalIds, refreshAniList } from '@/lib/airing-cache';

export type { AiringInfo } from '@/lib/airing-cache';

/**
 * Attaches `nextEpisode` / `nextEpisodeAt` to each airing, MAL-linked row from
 * the shared AiringCache, and overlays the freshest broadcast fields when the
 * cache has them (falling back to whatever is stored on the row). Stale entries
 * are refreshed in the background via after(), so reads stay fast and the next
 * reader gets warm data. Never throws — cache problems leave rows un-enriched.
 */
export async function enrichWithAiring<
  T extends {
    malId: number | null;
    airing: boolean;
    broadcastDay?: string | null;
    broadcastTime?: string | null;
    broadcastTimezone?: string | null;
    broadcastString?: string | null;
    airingStart?: string | null;
  }
>(rows: T[]): Promise<(T & { nextEpisode: number | null; nextEpisodeAt: number | null })[]> {
  const malIds = rows.filter((r) => r.airing && r.malId).map((r) => r.malId as number);

  let cache = new Map<number, Awaited<ReturnType<typeof getAiringForMalIds>>['rows'] extends Map<number, infer V> ? V : never>();
  if (malIds.length > 0) {
    try {
      const res = await getAiringForMalIds(malIds);
      cache = res.rows;
      if (res.stale.length > 0) {
        after(async () => {
          try {
            await refreshAniList(res.stale);
          } catch (e) {
            console.warn(`[anilist] background refresh failed: ${errorMessage(e)}`);
          }
        });
      }
    } catch (e) {
      console.warn(`[anilist] enrich skipped: ${errorMessage(e)}`);
    }
  }

  return rows.map((r) => {
    const c = r.airing && r.malId ? cache.get(r.malId) : undefined;
    return {
      ...r,
      nextEpisode: c?.nextEpisode ?? null,
      nextEpisodeAt: c?.nextEpisodeAt ?? null,
      broadcastDay: c?.broadcastDay ?? r.broadcastDay ?? null,
      broadcastTime: c?.broadcastTime ?? r.broadcastTime ?? null,
      broadcastTimezone: c?.broadcastTimezone ?? r.broadcastTimezone ?? null,
      broadcastString: c?.broadcastString ?? r.broadcastString ?? null,
      airingStart: c?.airingStart ?? r.airingStart ?? null,
    };
  });
}
```

> Note: the verbose `cache` type can be simplified to `Map<number, import('@/lib/airing-cache').AiringRow>` — import `AiringRow` and write `let cache = new Map<number, AiringRow>();`. Use that simpler form:

Replace the `let cache = …` line with, and add to the imports:

```ts
import { getAiringForMalIds, refreshAniList, type AiringRow } from '@/lib/airing-cache';
```
```ts
  let cache = new Map<number, AiringRow>();
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. The `enrichWithAiring` call site in `app/api/anime/route.ts:111` keeps compiling because the public signature/return type is unchanged.

- [ ] **Step 3: Commit**

```bash
git add lib/anilist.ts
git commit -m "refactor: enrichWithAiring reads shared cache + after() refresh"
```

---

## Task 4: Cache-back `/api/anime/popular-airing`

**Files:**
- Modify: `app/api/anime/popular-airing/route.ts`

- [ ] **Step 1: Swap the live AniList call for the cache**

Change the import at line 3 from:
```ts
import { fetchAniListAiring } from '@/lib/anilist';
```
to:
```ts
import { after } from 'next/server';
import { getAiringForMalIds, refreshAniList } from '@/lib/airing-cache';
import { errorMessage as _errorMessage } from '@/lib/api-error'; // (already imported as errorMessage; keep existing import)
```
(Keep the existing `import { errorMessage } from '@/lib/api-error';` — do not duplicate it; only add the `after` and `airing-cache` imports.)

Replace the block at lines 86–96:
```ts
    const airingIds = formattedData.filter((a) => a.airing).map((a) => a.mal_id);
    if (airingIds.length > 0) {
      const airingMap = await fetchAniListAiring(airingIds);
      for (const item of formattedData) {
        const info = airingMap.get(item.mal_id);
        if (info) {
          item.nextEpisode = info.episode;
          item.nextEpisodeAt = info.airingAt;
        }
      }
    }
```
with:
```ts
    const airingIds = formattedData.filter((a) => a.airing).map((a) => a.mal_id);
    if (airingIds.length > 0) {
      const { rows: cache, stale } = await getAiringForMalIds(airingIds);
      for (const item of formattedData) {
        const c = cache.get(item.mal_id);
        if (c) {
          item.nextEpisode = c.nextEpisode;
          item.nextEpisodeAt = c.nextEpisodeAt;
        }
      }
      if (stale.length > 0) {
        after(async () => {
          try {
            await refreshAniList(stale);
          } catch (e) {
            console.warn(`[popular-airing] background refresh failed: ${errorMessage(e)}`);
          }
        });
      }
    }
```

> Caveat: this route caches its whole payload in `popularCache` for 15 min, so the `nextEpisode` it serves can lag by up to 15 min — acceptable, and the background refresh keeps the cache warm. No behaviour change needed beyond the swap.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/anime/popular-airing/route.ts
git commit -m "refactor: popular-airing reads shared cache"
```

---

## Task 5: `POST /api/anime` schedules a background cache populate

**Files:**
- Modify: `app/api/anime/route.ts`

- [ ] **Step 1: Add imports**

At the top of `app/api/anime/route.ts` (with the other imports, after line 10):
```ts
import { after } from 'next/server';
import { refreshAniList, refreshBroadcast } from '@/lib/airing-cache';
```

- [ ] **Step 2: Schedule the populate right before the POST returns**

In `POST`, replace line 300 (`      return NextResponse.json(newAnime);`) with:
```ts
      // Populate the shared airing cache for this show in the background so the
      // next list read is warm and the badge fills in within ~1s. Non-blocking.
      if (newAnime.malId) {
        const malId = newAnime.malId;
        after(async () => {
          try {
            await refreshAniList([malId]);
            await refreshBroadcast([malId]);
          } catch {
            /* best-effort; never affects the add response */
          }
        });
      }
      return NextResponse.json(newAnime);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/anime/route.ts
git commit -m "feat: warm airing cache in background on anime add"
```

---

## Task 6: Replace the 40s `sync-airing` loop with a fast trigger

**Files:**
- Modify: `app/api/anime/sync-airing/route.ts` (replace entire file)

- [ ] **Step 1: Replace the file**

Overwrite `app/api/anime/sync-airing/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';
import { refreshAniList, refreshBroadcast } from '@/lib/airing-cache';

/**
 * Legacy endpoint. The old 40s blocking Jikan loop is gone: airing data now lives
 * in the shared AiringCache (refreshed lazily on read + by a daily cron). This
 * handler just schedules a background refresh for the caller's incomplete shows
 * and returns immediately, so existing clients don't 404 during rollout.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const rows = await db.anime.findMany({
      where: { userId: session.userId, status: 'incomplete', malId: { not: null } },
      select: { malId: true },
    });
    const malIds = rows.map((r) => r.malId as number).filter(Boolean);
    if (malIds.length > 0) {
      after(async () => {
        try {
          await refreshAniList(malIds);
          await refreshBroadcast(malIds);
        } catch {
          /* best-effort */
        }
      });
    }
    return NextResponse.json({
      message: 'Refresh scheduled.',
      syncedCount: malIds.length,
      errorCount: 0,
      totalChecked: malIds.length,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
```

> The response keeps the `{ message, syncedCount, errorCount, totalChecked }` shape so the mobile `SyncAiringResult` type still parses during the rollout window.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/anime/sync-airing/route.ts
git commit -m "refactor: sync-airing is now a fast background trigger"
```

---

## Task 7: Daily cron + `vercel.json`

**Files:**
- Create: `app/api/cron/refresh-airing/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Write the cron handler**

Create `app/api/cron/refresh-airing/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { refreshAniList, refreshBroadcast } from '@/lib/airing-cache';
import { errorMessage } from '@/lib/api-error';

// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when the env
// var is set. Hobby functions may run up to 60s; the Jikan loop below is bounded
// to fit that budget (take: 120 × 350ms ≈ 42s).
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Every malId any user is currently tracking as airing.
    const tracked = await db.anime.findMany({
      where: { airing: true, malId: { not: null } },
      select: { malId: true },
      distinct: ['malId'],
    });
    const malIds = [...new Set(tracked.map((t) => t.malId as number))].filter(Boolean);

    // AniList is batched + fast — refresh all tracked airing shows.
    let aniListUpdated = 0;
    try {
      aniListUpdated = await refreshAniList(malIds);
    } catch (e) {
      console.warn(`[cron] AniList refresh failed: ${errorMessage(e)}`);
    }

    // Jikan is slow — refresh the oldest-synced subset that fits the time budget.
    const oldest = await db.airingCache.findMany({
      orderBy: { syncedAt: 'asc' },
      take: 120,
      select: { malId: true },
    });
    let broadcastUpdated = 0;
    try {
      broadcastUpdated = await refreshBroadcast(oldest.map((o) => o.malId));
    } catch (e) {
      console.warn(`[cron] Jikan refresh failed: ${errorMessage(e)}`);
    }

    return NextResponse.json({ ok: true, tracked: malIds.length, aniListUpdated, broadcastUpdated });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `vercel.json`**

Create `vercel.json` at the repo root:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/refresh-airing",
      "schedule": "0 18 * * *"
    }
  ]
}
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS; the build output lists `/api/cron/refresh-airing` as a route.

- [ ] **Step 4: Manual local check of the auth gate**

Run the dev server (`npm run dev`) and in another shell:
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/refresh-airing`
Expected: `401` (no/!wrong bearer).
Run (replace `<secret>` with a value also set in `.env` as `CRON_SECRET`): `curl -s -H "Authorization: Bearer <secret>" http://localhost:3000/api/cron/refresh-airing`
Expected: JSON `{ "ok": true, "tracked": <n>, ... }`.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/refresh-airing/route.ts vercel.json
git commit -m "feat: daily cron to pre-warm the airing cache"
```

---

## Task 8: Remove the web "Sync Schedules" button

**Files:**
- Modify: the web airing-schedule page (find it; per `code-explorer` it is `app/airing-schedule/page.tsx`, with the button around lines 163–184 / 472–479)

- [ ] **Step 1: Locate the button and its handler**

Run: `grep -n "sync-airing\|handleSyncAiring\|Sync Schedule" app/airing-schedule/page.tsx`
Expected: matches for the `fetch('/api/anime/sync-airing'…)` handler and the button JSX.

- [ ] **Step 2: Remove the button JSX and the `handleSyncAiring` function**

Delete the `<button …>Sync Schedules</button>` element and the `handleSyncAiring` handler + any state it owns (`syncing`, sync toast). Leave the rest of the page (the list fetch, the popular fetch, episode progress updates) untouched. The airing data now refreshes automatically.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS, no unused-variable lint errors referencing the removed handler/state.

- [ ] **Step 4: Commit**

```bash
git add app/airing-schedule/page.tsx
git commit -m "feat(web): remove manual Sync Schedules button (auto-refresh now)"
```

---

## Task 9: Verification script, deploy to production, enable the cron

**Files:**
- Create: `scripts/verify-airing-cache.ts`

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-airing-cache.ts`:

```ts
import { db } from '../lib/db';
import { refreshAniList, refreshBroadcast, getAiringForMalIds } from '../lib/airing-cache';

// One Piece (21), Frieren (52991) — adjust as needed.
const SAMPLE = [21, 52991];

async function main() {
  console.log('refreshAniList…', await refreshAniList(SAMPLE), 'rows');
  console.log('refreshBroadcast…', await refreshBroadcast(SAMPLE), 'rows');
  const { rows, stale } = await getAiringForMalIds(SAMPLE);
  console.log('stale after refresh (expect []):', stale);
  for (const id of SAMPLE) console.log(id, rows.get(id));
  const all = await db.airingCache.findMany();
  console.log(`AiringCache now holds ${all.length} rows.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it against dev**

Run: `npx tsx scripts/verify-airing-cache.ts`
Expected: non-zero refresh counts; `stale after refresh` is `[]` (or only ids AniList has no upcoming episode for); printed rows show real `nextEpisode`/`nextEpisodeAt` for currently-airing shows.

- [ ] **Step 3: Apply the migration to the production Neon branch**

Per `lib/deploy` ownership: run the mirror script against prod by pointing `DATABASE_URL` at the production branch (or use the prod `.env`):
Run: `DATABASE_URL="<prod-neon-url>" npx tsx scripts/migrate-add-airing-cache.ts`
Expected: "Done." Confirm the table exists with `mcp__plugin_neon_neon__get_database_tables` or `npx prisma studio` against prod.

- [ ] **Step 4: Commit the script, push `main`, confirm production deploy**

```bash
git add scripts/verify-airing-cache.ts
git commit -m "chore: airing-cache verification script"
git push origin main
```
Then confirm the Vercel production deployment succeeds (dashboard or `mcp__claude_ai_Vercel__list_deployments`).

- [ ] **Step 5: Enable the cron (user action — provide these exact steps)**

Tell the user (khushi's Vercel, Hobby, CLI not linked):
1. Vercel Dashboard → the OtakuMind project → **Settings → Environment Variables** → add `CRON_SECRET` = a long random string (e.g. `openssl rand -hex 32`) for **Production** (and Preview/Development if desired). Redeploy so it takes effect.
2. After the deploy that includes `vercel.json`, go to **Project → Cron Jobs** and confirm `/api/cron/refresh-airing` is listed with schedule `0 18 * * *`. Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on each invocation.
3. Optional: click **Run** on the cron job to trigger it once and check the function logs for `{ ok: true, … }`.

---

## Task 10: Mobile — optimistic create + badge shimmer (repo: `otakumind-mobile`, author: shevilll)

**Files:**
- Modify: `src/api/anime.ts` (`useCreateAnime`)
- Modify: the Add-anime screen / next-episode badge component (find via grep)

- [ ] **Step 1: Make `useCreateAnime` optimistically insert + delayed-refetch**

In `src/api/anime.ts`, replace `useCreateAnime` (lines 110–120) with:

```ts
export function useCreateAnime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAnimeInput) =>
      apiFetch<Anime>('/api/anime', { method: 'POST', json: input }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['anime'] });
      queryClient.invalidateQueries({ queryKey: qk.stats });
      // The server populates the shared airing cache in the background (~1s);
      // refetch once shortly after so the next-episode badge fills in without a
      // manual pull-to-refresh. Harmless if the row isn't airing.
      if (created?.airing && created?.malId) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: qk.incompleteAll });
          queryClient.invalidateQueries({ queryKey: ['anime'] });
        }, 1500);
      }
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` (from the mobile repo root)
Expected: PASS.

- [ ] **Step 3: Add a shimmer to the next-episode badge while `nextEpisode` is null**

Find the badge: `grep -rn "nextEpisode" src` — locate the component that renders the airing badge (likely in the airing tab and/or an `AnimeRow`/card). Where it currently renders the episode number, render a small shimmer placeholder when `anime.airing && anime.nextEpisode == null`. Use the existing static skeleton style noted in memory (no animation required) — a short muted pill the same width as the number. Example pattern (adapt to the actual component/styles):

```tsx
{anime.airing && anime.nextEpisode == null ? (
  <View style={styles.badgeSkeleton} />
) : anime.nextEpisode != null ? (
  <Text style={styles.badge}>EP {anime.nextEpisode}</Text>
) : null}
```

- [ ] **Step 4: Manual check**

Run the app against the deployed backend (`EXPO_PUBLIC_API_BASE_URL`). Add a currently-airing show → the row appears immediately with a placeholder badge → within ~1–2s the episode number/countdown fills in. Add a finished show → no badge, no placeholder lingering.

- [ ] **Step 5: Commit**

```bash
git add src/api/anime.ts <badge component path>
git commit -m "feat: optimistic-ish add with airing badge shimmer until cache warms"
```

---

## Task 11: Mobile — remove the Sync Schedules button (repo: `otakumind-mobile`, author: shevilll)

**Files:**
- Modify: `src/api/airing.ts` (remove `useSyncAiring`)
- Modify: the airing tab screen (remove the button)

- [ ] **Step 1: Find usages**

Run: `grep -rn "useSyncAiring\|SyncAiringResult\|Sync Schedule" src`
Expected: the hook definition in `src/api/airing.ts` and its use in the airing tab screen.

- [ ] **Step 2: Remove the button from the airing tab**

Delete the "Sync Schedules" button JSX and the `useSyncAiring()` call/handler + any local `syncing` state and toast in the airing screen. Leave the rest of the screen intact.

- [ ] **Step 3: Remove the hook**

In `src/api/airing.ts`, delete `useSyncAiring` and the `SyncAiringResult` interface (lines 16–31). Keep `usePopularAiring`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no remaining references to `useSyncAiring`/`SyncAiringResult`).

- [ ] **Step 5: Commit**

```bash
git add src/api/airing.ts <airing screen path>
git commit -m "feat: remove manual Sync Schedules button (auto-refresh now)"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Table (T1), refresh module (T2), read enrichment + after() (T3), popular-airing (T4), instant add populate (T5), kill 40s loop (T6), cron + Hobby (T7), web button (T8), migration/deploy/cron-enable + verification (T9), mobile optimistic + shimmer (T10), mobile button (T11). All spec sections map to a task.
- **Contract unchanged:** `enrichWithAiring` keeps its signature; the API JSON shape is unchanged → web/mobile read paths untouched.
- **Type consistency:** `getAiringForMalIds` returns `{ rows: Map<number, AiringRow>; stale: number[] }` and is consumed with that exact shape in T3 and T4; `refreshAniList`/`refreshBroadcast` take `number[]` and return `Promise<number>` everywhere they're called.
- **No new index work here** beyond `AiringCache`'s own indexes; the `@@index([userId, malId])` quick win is a separate scope item.
```
