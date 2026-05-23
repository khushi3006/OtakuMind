import { NextResponse } from 'next/server';

// Lightweight in-memory cache to prevent Jikan API rate limiting on user dashboard loads
let popularCache: any = null;
let popularCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

export async function GET() {
  try {
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
    const formattedData: any[] = [];

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
      });
    }

    const responsePayload = { data: formattedData };
    popularCache = responsePayload;
    popularCacheTime = now;

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
