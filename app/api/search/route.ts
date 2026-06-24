import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/api-error';
import { requireEntitlement } from '@/lib/require-entitlement';
import { anilistFetch, mapMediaToJikan, MEDIA_FIELDS } from '@/lib/anilist-client';

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

// Global in-memory cache for anime search suggestions
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes Time-To-Live

const SEARCH_QUERY = `
  query ($q: String, $page: Int) {
    Page(page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

export async function GET(request: Request) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    
    if (!q) return NextResponse.json({ data: [] });

    const page = searchParams.get('page') || '1';
    const cacheKey = `${q.trim().toLowerCase()}_page_${page}`;

    // Serve from cache if valid and present
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    try {
      const data = await anilistFetch<{
        Page?: { pageInfo?: { hasNextPage?: boolean }; media?: unknown[] };
      }>(SEARCH_QUERY, { q, page: Number(page) || 1 }, 5000);

      // Map AniList media -> the legacy Jikan-shaped envelope every client still
      // expects. Entries without a linked MAL id are dropped (app is MAL-keyed).
      const media = data?.Page?.media ?? [];
      const seen = new Set<number>();
      const results = [];
      for (const m of media) {
        const mapped = mapMediaToJikan(m as Parameters<typeof mapMediaToJikan>[0]);
        if (!mapped || seen.has(mapped.mal_id)) continue;
        seen.add(mapped.mal_id);
        results.push(mapped);
      }
      const json = {
        data: results,
        pagination: { has_next_page: data?.Page?.pageInfo?.hasNextPage ?? false },
      };

      // Update cache
      searchCache.set(cacheKey, {
        data: json,
        timestamp: Date.now()
      });

      return NextResponse.json(json);
    } catch (fetchError: unknown) {
      // Fetch failed (network timeout or offline). Serve expired cache if we have it
      if (cached) {
        console.warn(`[Search Cache] Fetch failed (${errorMessage(fetchError)}). Serving expired cache fallback.`);
        return NextResponse.json(cached.data);
      }
      throw fetchError;
    }
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error, 'Internal Server Error') }, { status: 500 });
  }
}
