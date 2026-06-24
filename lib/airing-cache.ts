import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';
import { anilistFetch } from '@/lib/anilist-client';

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
  /** 'releasing' | 'finished' | 'unknown' — drives whether to keep the airing flag. */
  releaseStatus: string;
}

const FETCH_TIMEOUT = 4000;
const ANILIST_BATCH = 50;
const STALE_TTL_MS = 1000 * 60 * 60 * 12; // 12h safety net

// One batched query now supplies BOTH the next-episode countdown and the weekly
// broadcast slot (derived from the exact air time below), so AniList is the sole
// upstream — no more per-id Jikan calls for broadcast data.
const ANILIST_QUERY = `
  query ($ids: [Int]) {
    Page(perPage: 50) {
      media(idMal_in: $ids, type: ANIME) {
        idMal
        status
        startDate { year month day }
        nextAiringEpisode { episode airingAt }
      }
    }
  }
`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Derived broadcast fields (kept in JST so lib/airing-utils interprets them
 * exactly as it did the Jikan-supplied values). */
interface DerivedBroadcast {
  broadcastDay: string | null;
  broadcastTime: string | null;
  broadcastTimezone: string | null;
  broadcastString: string | null;
}

/**
 * Turns an exact UTC air time into the JST weekly-slot fields the UI expects.
 * AniList gives a precise instant; the legacy schedule UI works in JST broadcast
 * day/time, so we project the instant into JST and format it the Jikan way
 * ("Saturdays", "23:00", "Saturdays at 23:00 (JST)").
 */
function deriveBroadcast(airingAt: number | null): DerivedBroadcast {
  if (!airingAt) {
    return { broadcastDay: null, broadcastTime: null, broadcastTimezone: null, broadcastString: null };
  }
  const jst = new Date((airingAt + 9 * 60 * 60) * 1000); // shift UTC -> JST
  const dayName = WEEKDAYS[jst.getUTCDay()];
  const time = `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
  return {
    broadcastDay: `${dayName}s`,
    broadcastTime: time,
    broadcastTimezone: 'JST',
    broadcastString: `${dayName}s at ${time} (JST)`,
  };
}

function startDateToIso(d: { year?: number | null; month?: number | null; day?: number | null } | null): string | null {
  if (!d?.year) return null;
  return `${d.year}-${pad(d.month ?? 1)}-${pad(d.day ?? 1)}T00:00:00+00:00`;
}

function mapStatus(s: string): string {
  if (s === 'FINISHED' || s === 'CANCELLED') return 'finished';
  return s ? 'releasing' : 'unknown';
}

interface AniListMedia {
  idMal: number;
  status: string;
  next: AiringInfo | null;
  airingStart: string | null;
}

async function queryAniListBatch(ids: number[]): Promise<AniListMedia[]> {
  const data = await anilistFetch<{ Page?: { media?: unknown[] } }>(
    ANILIST_QUERY,
    { ids },
    FETCH_TIMEOUT
  );
  const media = data?.Page?.media ?? [];
  const out: AniListMedia[] = [];
  for (const raw of media) {
    const m = raw as {
      idMal?: number;
      status?: string;
      startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
      nextAiringEpisode?: { episode?: number; airingAt?: number } | null;
    };
    if (!m?.idMal) continue;
    const n = m.nextAiringEpisode;
    const next =
      n && typeof n.episode === 'number' && typeof n.airingAt === 'number'
        ? { episode: n.episode, airingAt: n.airingAt }
        : null;
    out.push({
      idMal: m.idMal,
      status: m.status ?? '',
      next,
      airingStart: startDateToIso(m.startDate ?? null),
    });
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
      releaseStatus: r.releaseStatus,
    });
    const expired = now - r.syncedAt.getTime() >= STALE_TTL_MS;
    const aired = r.nextEpisodeAt != null && r.nextEpisodeAt * 1000 <= now;
    const noEpisode = r.nextEpisode == null || r.nextEpisodeAt == null;
    if (expired || aired || noEpisode) stale.push(id);
  }
  return { rows, stale };
}

/**
 * Refreshes AniList data for the given MAL ids (batched, ≤50/req) and upserts the
 * cache rows. A single batched query supplies both the next-episode countdown and
 * the weekly broadcast slot (derived from the exact air time), so this is the only
 * refresh the app needs. Returns the number of rows touched. Never throws.
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
        const broadcast = deriveBroadcast(next?.airingAt ?? null);
        await db.airingCache.upsert({
          where: { malId },
          create: {
            malId,
            nextEpisode: next?.episode ?? null,
            nextEpisodeAt: next?.airingAt ?? null,
            broadcastDay: broadcast.broadcastDay,
            broadcastTime: broadcast.broadcastTime,
            broadcastTimezone: broadcast.broadcastTimezone,
            broadcastString: broadcast.broadcastString,
            airingStart: hit?.airingStart ?? null,
            releaseStatus,
          },
          update: {
            nextEpisode: next?.episode ?? null,
            nextEpisodeAt: next?.airingAt ?? null,
            broadcastDay: broadcast.broadcastDay,
            broadcastTime: broadcast.broadcastTime,
            broadcastTimezone: broadcast.broadcastTimezone,
            broadcastString: broadcast.broadcastString,
            airingStart: hit?.airingStart ?? null,
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
