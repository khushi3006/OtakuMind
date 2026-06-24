import { NextResponse, after } from 'next/server';
import { errorMessage } from '@/lib/api-error';
import { getAiringForMalIds, refreshAniList } from '@/lib/airing-cache';
import { anilistFetch, mapMediaToJikan, MEDIA_FIELDS } from '@/lib/anilist-client';
import { requireEntitlement } from '@/lib/require-entitlement';

interface PopularAnime {
  mal_id: number;
  title: string;
  title_english: string | null;
  images: { jpg: { image_url: string | null } };
  airing: boolean;
  broadcast: Record<string, unknown>;
  type: string;
  score: number | null;
  synopsis: string | null;
  episodes: number;
  aired: unknown;
  nextEpisode: number | null;
  nextEpisodeAt: number | null;
}

interface PopularPayload {
  data: PopularAnime[];
}

// Lightweight in-memory cache to prevent API rate limiting on user dashboard loads
let popularCache: PopularPayload | null = null;
let popularCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

const POPULAR_QUERY = `
  query ($season: MediaSeason, $year: Int) {
    Page(perPage: 8) {
      media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

/** Current AniList season + year (anime seasons are 3-month blocks). */
function currentSeason(): { season: string; year: number } {
  const now = new Date();
  const month = now.getUTCMonth(); // 0-11
  const year = now.getUTCFullYear();
  if (month <= 1 || month === 11) return { season: 'WINTER', year: month === 11 ? year + 1 : year };
  if (month <= 4) return { season: 'SPRING', year };
  if (month <= 7) return { season: 'SUMMER', year };
  return { season: 'FALL', year };
}

export async function GET(request: Request) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;

    const now = Date.now();

    if (popularCache && (now - popularCacheTime < CACHE_DURATION)) {
      return NextResponse.json(popularCache);
    }

    const { season, year } = currentSeason();
    let aniData: { Page?: { media?: unknown[] } };
    try {
      aniData = await anilistFetch(POPULAR_QUERY, { season, year });
    } catch (e) {
      // Return stale cache if available, otherwise surface the error.
      if (popularCache) {
        return NextResponse.json(popularCache);
      }
      throw new Error(`Failed to fetch popular airing anime from AniList: ${errorMessage(e)}`);
    }

    // Deduplicate and format data to ensure unique entries
    const seenMalIds = new Set<number>();
    const formattedData: PopularAnime[] = [];

    for (const raw of (aniData?.Page?.media || [])) {
      const anime = mapMediaToJikan(raw as Parameters<typeof mapMediaToJikan>[0]);
      if (!anime || seenMalIds.has(anime.mal_id)) {
        continue;
      }
      seenMalIds.add(anime.mal_id);

      formattedData.push({
        mal_id: anime.mal_id,
        title: anime.title,
        title_english: anime.title_english,
        images: {
          jpg: {
            image_url: anime.images?.jpg?.image_url || null,
          }
        },
        airing: anime.airing || false,
        broadcast: anime.broadcast || {},
        type: anime.type || 'TV',
        score: anime.score || null,
        synopsis: anime.synopsis || null,
        episodes: anime.episodes || 0,
        aired: anime.aired || null,
        nextEpisode: null,
        nextEpisodeAt: null,
      });
    }

    // Attach the real next-episode number + exact air time from AniList (cached,
    // best-effort). Cached alongside the payload so we don't re-query every load.
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

    const responsePayload = { data: formattedData };
    popularCache = responsePayload;
    popularCacheTime = now;

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
