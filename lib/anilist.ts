import { errorMessage } from '@/lib/api-error';

/**
 * AniList next-airing-episode lookup, keyed by MAL id.
 *
 * Jikan (our primary source) does not expose a reliable next-episode number, so
 * the old approach fabricated it from the premiere date (weeks-since-premiere),
 * which drifts badly for long/hiatus-prone shows (One Piece showed "Ep 1391"
 * instead of 1165). AniList's GraphQL API returns the real `nextAiringEpisode`
 * for free (no API key, public read), so we enrich our responses with it.
 *
 * Results are cached in-process per MAL id (the same pattern as the Jikan search
 * cache) to stay well under AniList's rate limit. The countdown itself is derived
 * client-side from `airingAt`, so a cached entry stays accurate until the episode
 * airs — at which point we treat it as stale and refetch.
 */

export interface AiringInfo {
  /** The next episode number that will air (e.g. 1165 for One Piece). */
  episode: number;
  /** Exact air time as a Unix timestamp in seconds, UTC. */
  airingAt: number;
}

interface CacheEntry {
  /** null = AniList has no upcoming episode (finished / on hiatus / unknown id). */
  data: AiringInfo | null;
  timestamp: number;
}

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const MAX_BATCH = 50; // AniList Page size cap we request
const FETCH_TIMEOUT = 4000; // keep list endpoints snappy on AniList slowness

const cache = new Map<number, CacheEntry>();

const QUERY = `
  query ($ids: [Int]) {
    Page(perPage: 50) {
      media(idMal_in: $ids, type: ANIME) {
        idMal
        nextAiringEpisode {
          episode
          airingAt
        }
      }
    }
  }
`;

function isFresh(entry: CacheEntry, now: number): boolean {
  if (now - entry.timestamp >= CACHE_TTL) return false;
  // If the cached episode's air time has already passed, the next episode has
  // rolled over on AniList — force a refetch so the number stays correct.
  if (entry.data && entry.data.airingAt * 1000 <= now) return false;
  return true;
}

async function queryAniList(ids: number[]): Promise<Map<number, AiringInfo>> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { ids } }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) throw new Error(`AniList API returned status ${res.status}`);

  const json = await res.json();
  const media = json?.data?.Page?.media ?? [];
  const out = new Map<number, AiringInfo>();
  for (const m of media) {
    const next = m?.nextAiringEpisode;
    if (m?.idMal && next && typeof next.episode === 'number' && typeof next.airingAt === 'number') {
      out.set(m.idMal, { episode: next.episode, airingAt: next.airingAt });
    }
  }
  return out;
}

/**
 * Returns a map of MAL id -> next airing info for the ids that have an upcoming
 * episode. Misses (finished shows, unknown ids, AniList errors) are simply absent
 * from the map, so callers degrade gracefully to "no episode number".
 */
export async function fetchAniListAiring(malIds: number[]): Promise<Map<number, AiringInfo>> {
  const result = new Map<number, AiringInfo>();
  const now = Date.now();
  const misses: number[] = [];

  for (const id of new Set(malIds)) {
    if (!id) continue;
    const entry = cache.get(id);
    if (entry && isFresh(entry, now)) {
      if (entry.data) result.set(id, entry.data);
    } else {
      misses.push(id);
    }
  }

  for (let i = 0; i < misses.length; i += MAX_BATCH) {
    const batch = misses.slice(i, i + MAX_BATCH);
    try {
      const fetched = await queryAniList(batch);
      // Cache every requested id — including absences — so finished shows and
      // unknown ids don't get re-queried each time.
      for (const id of batch) {
        const data = fetched.get(id) ?? null;
        cache.set(id, { data, timestamp: now });
        if (data) result.set(id, data);
      }
    } catch (error) {
      // On failure fall back to any (even stale) cached value; otherwise skip.
      console.warn(`[AniList] airing fetch failed: ${errorMessage(error)}`);
      for (const id of batch) {
        const stale = cache.get(id);
        if (stale?.data) result.set(id, stale.data);
      }
    }
  }

  return result;
}

/**
 * Attaches `nextEpisode` / `nextEpisodeAt` to each row that is currently airing
 * and MAL-linked. Non-airing rows and lookup misses get `null` for both fields.
 * Never throws — AniList problems leave the rows un-enriched.
 */
export async function enrichWithAiring<T extends { malId: number | null; airing: boolean }>(
  rows: T[]
): Promise<(T & { nextEpisode: number | null; nextEpisodeAt: number | null })[]> {
  const malIds = rows.filter((r) => r.airing && r.malId).map((r) => r.malId as number);

  let airingMap = new Map<number, AiringInfo>();
  if (malIds.length > 0) {
    try {
      airingMap = await fetchAniListAiring(malIds);
    } catch (error) {
      console.warn(`[AniList] enrich skipped: ${errorMessage(error)}`);
    }
  }

  return rows.map((r) => {
    const info = r.airing && r.malId ? airingMap.get(r.malId) : undefined;
    return {
      ...r,
      nextEpisode: info ? info.episode : null,
      nextEpisodeAt: info ? info.airingAt : null,
    };
  });
}
