import { after } from 'next/server';
import { errorMessage } from '@/lib/api-error';
import { getAiringForMalIds, refreshAniList, type AiringRow } from '@/lib/airing-cache';

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

  let cache = new Map<number, AiringRow>();
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
