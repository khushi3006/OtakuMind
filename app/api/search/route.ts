import { NextResponse } from 'next/server';
import { apiCache } from '@/lib/cache';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    
    if (!q) return NextResponse.json({ data: [] });

    const cacheKey = `jikan:${q.toLowerCase().trim()}`;

    const json = await apiCache.getOrSet(cacheKey, async () => {
      const res = await fetch(
        `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=5&sfw=true`
      );
      return res.json();
    }, 300); // 5 minute TTL — Jikan results don't change

    const response = NextResponse.json(json);
    response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
