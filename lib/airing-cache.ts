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
    const results = await Promise.allSettled(
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
        return 1;
      })
    );
    updated += results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn(`[airing-cache] AniList upsert failed: ${errorMessage(r.reason)}`);
      }
    }
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
          releaseStatus: d.airing ? 'releasing' : (d.status === 'Finished Airing' ? 'finished' : 'unknown'),
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
