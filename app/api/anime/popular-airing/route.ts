import { NextResponse, after } from 'next/server';
import { errorMessage } from '@/lib/api-error';
import { getAiringForMalIds, refreshAniList } from '@/lib/airing-cache';
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

// Lightweight in-memory cache to prevent Jikan API rate limiting on user dashboard loads
let popularCache: PopularPayload | null = null;
let popularCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

export async function GET(request: Request) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;

    const now = Date.now();

    if (popularCache && (now - popularCacheTime < CACHE_DURATION)) {
      return NextResponse.json(popularCache);
    }

    const res = await fetch(
      'https://api.jikan.moe/v4/seasons/now?limit=8&sfw=true',
      { next: { revalidate: 900 } } // Also leverage Next.js fetch caching
    );

    if (!res.ok) {
      // Return stale cache if available, otherwise return error
      if (popularCache) {
        return NextResponse.json(popularCache);
      }
      throw new Error(`Failed to fetch popular airing anime from Jikan: HTTP ${res.status}`);
    }

    const json = await res.json();
    
    // Deduplicate and format data to ensure unique entries
    const seenMalIds = new Set<number>();
    const formattedData: PopularAnime[] = [];

    for (const anime of (json.data || [])) {
      if (!anime.mal_id || seenMalIds.has(anime.mal_id)) {
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
