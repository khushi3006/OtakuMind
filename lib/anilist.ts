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
    const nextEpisode = c?.nextEpisode ?? null;
    const nextEpisodeAt = c?.nextEpisodeAt ?? null;
    const broadcastDay = c?.broadcastDay ?? r.broadcastDay ?? null;
    const broadcastTime = c?.broadcastTime ?? r.broadcastTime ?? null;

    // Re-evaluate the stored `airing` flag against fresh cache data. The flag is
    // captured at add-time and never updated, so it goes stale: an
    // announced-but-unscheduled title (no next episode, no broadcast slot) or a
    // show that has since finished keeps claiming to be airing, leaving clients
    // stuck on a "next episode" placeholder for data that will never arrive.
    //
    // Only override when the cache has DEFINITIVELY resolved this show (`c`
    // present). A cache miss (c undefined → still warming) leaves the flag alone
    // so genuinely-airing rows still fill in on the next read. Once resolved, a
    // row counts as airing only if it isn't finished AND has something to count
    // down to — a next episode or a weekly broadcast slot. (Finished shows keep
    // a lingering broadcast day/time, so the releaseStatus guard is what
    // turns those off.)
    let airing = r.airing;
    if (c) {
      const hasCountdown = nextEpisode != null || Boolean(broadcastDay && broadcastTime);
      airing = c.releaseStatus !== 'finished' && hasCountdown;
    }

    return {
      ...r,
      airing,
      nextEpisode,
      nextEpisodeAt,
      broadcastDay,
      broadcastTime,
      broadcastTimezone: c?.broadcastTimezone ?? r.broadcastTimezone ?? null,
      broadcastString: c?.broadcastString ?? r.broadcastString ?? null,
      airingStart: c?.airingStart ?? r.airingStart ?? null,
    };
  });
}
