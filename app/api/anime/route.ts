import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiCache } from '@/lib/cache';
import { normalizeAnimeName, extractSeasonNumber } from '@/lib/normalize';

const ALLOWED_LIMITS = [20, 50, 100] as const;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = ALLOWED_LIMITS.includes(rawLimit as any) ? rawLimit : 20;

    const cacheKey = `anime:${status || 'all'}:${page}:${limit}:${search || ''}`;

    const result = await apiCache.getOrSet(cacheKey, async () => {
      const where: any = {};
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { normalizedName: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [animes, total] = await Promise.all([
        db.anime.findMany({
          where,
          orderBy: status === 'completed'
            ? { originalOrder: 'asc' }
            : status === 'incomplete'
              ? [{ watchOrder: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]
              : { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.anime.count({ where }),
      ]);

      return {
        data: animes,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }, 30); // 30 second TTL

    const response = NextResponse.json(result);
    response.headers.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, episodesWatched, status, imageUrl, malId, type } = body;
    
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const normalizedName = normalizeAnimeName(name);
    const season = extractSeasonNumber(name);

    let finalType = type || "TV";
    if (!type) {
      const isMovie = name.match(/\b(movie|film)\b/i) || (!name.match(/season/i) && !name.match(/episode/i) && !name.match(/s\d+/i) && !name.match(/part/i) && name.length > 0);
      if (isMovie) finalType = "Movie";
    }

    const newAnime = await db.anime.create({
      data: {
        name,
        normalizedName,
        season,
        episodesWatched: episodesWatched || 0,
        status: status || 'incomplete',
        imageUrl: imageUrl || null,
        malId: malId || null,
        type: finalType,
      }
    });

    // Invalidate all anime list caches and stats
    apiCache.invalidatePrefix('anime:');
    apiCache.invalidate('stats');

    return NextResponse.json(newAnime);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
