import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/api-error';
import { requireEntitlement } from '@/lib/require-entitlement';

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

// Global in-memory cache for Jikan search suggestions
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes Time-To-Live

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
      const res = await fetch(
        `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=25&page=${page}&sfw=true`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000), // 5 seconds timeout to keep UX snappy
        }
      );

      if (!res.ok) {
        // If Jikan API is rate limited or returns error, try to serve expired cache fallback
        if (cached) {
          console.warn(`[Search Cache] External API error ${res.status}. Serving expired cache fallback.`);
          return NextResponse.json(cached.data);
        }
        const errorJson = await res.json().catch(() => ({}));
        const errorMsg = errorJson.message || errorJson.error || `Jikan API returned status ${res.status}`;
        return NextResponse.json({ error: errorMsg }, { status: res.status });
      }

      const json = await res.json();
      
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
