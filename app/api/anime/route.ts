import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeAnimeName, extractSeasonNumber } from '@/lib/normalize';
import type { Prisma } from '@/prisma/generated/client';
import { normalizeWatchingOrder } from '@/lib/watch-order';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';

const ALLOWED_LIMITS = [20, 50, 100] as const;

function isSchemaValidationError(error: unknown) {
  return error instanceof Error && (
    error.message.includes('Unknown argument `completedAt`') ||
    error.message.includes('Unknown argument `droppedAt`')
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = ALLOWED_LIMITS.includes(rawLimit as (typeof ALLOWED_LIMITS)[number]) ? rawLimit : 20;

    const where: Prisma.AnimeWhereInput = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { normalizedName: { contains: search, mode: 'insensitive' } },
      ];
    }

    let orderBy: any;
    if (status === 'completed') {
      if (sort === 'completed_asc') {
        orderBy = [
          { completedAt: { sort: 'asc' as const, nulls: 'last' as const } },
          { originalOrder: 'asc' as const },
          { createdAt: 'desc' as const }
        ];
      } else if (sort === 'created_desc') {
        orderBy = [{ createdAt: 'desc' as const }];
      } else if (sort === 'created_asc') {
        orderBy = [{ createdAt: 'asc' as const }];
      } else if (sort === 'alphabetical_asc') {
        orderBy = [{ name: 'asc' as const }];
      } else if (sort === 'alphabetical_desc') {
        orderBy = [{ name: 'desc' as const }];
      } else {
        // Default to LIFO: Recently Completed
        orderBy = [
          { completedAt: { sort: 'desc' as const, nulls: 'last' as const } },
          { originalOrder: 'asc' as const },
          { createdAt: 'desc' as const }
        ];
      }
    } else if (status === 'incomplete') {
      orderBy = [{ watchOrder: { sort: 'asc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];
    } else {
      orderBy = [{ droppedAt: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];
    }

    let animes;
    let total;

    try {
      [animes, total] = await Promise.all([
        db.anime.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.anime.count({ where }),
      ]);
    } catch (error) {
      if (!isSchemaValidationError(error)) {
        throw error;
      }

      const fallbackOrderBy = status === 'completed'
        ? { originalOrder: 'asc' as const }
        : { createdAt: 'desc' as const };

      [animes, total] = await Promise.all([
        db.anime.findMany({
          where,
          orderBy: fallbackOrderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.anime.count({ where }),
      ]);
    }

    const result = {
      data: animes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      totalEpisodes,
      episodesWatched,
      status,
      imageUrl,
      malId,
      type,
      airing,
      broadcastDay,
      broadcastTime,
      broadcastTimezone,
      broadcastString,
      airingStart
    } = body;
    const targetStatus = status || 'incomplete';
    
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const normalizedName = normalizeAnimeName(name);
    const season = extractSeasonNumber(name);

    // Check for duplicates in ANY status
    const existingAnime = await db.anime.findFirst({
      where: {
        OR: [
          malId ? { malId: Number(malId) } : { id: -1 },
          { 
            normalizedName,
            season,
          }
        ]
      }
    });

    if (existingAnime) {
      if (existingAnime.status === 'incomplete') {
        return NextResponse.json(
          { error: "This anime is already in your watching list", type: "DUPLICATE_INCOMPLETE" },
          { status: 409 }
        );
      } else {
        return NextResponse.json(
          { 
            error: `This anime is in your ${existingAnime.status} list`,
            type: "DUPLICATE_OTHER_STATUS",
            existingAnime
          },
          { status: 409 }
        );
      }
    }

    let finalType = type || "TV";
    if (!type) {
      const isMovie = name.match(/\b(movie|film)\b/i) || (!name.match(/season/i) && !name.match(/episode/i) && !name.match(/s\d+/i) && !name.match(/part/i) && name.length > 0);
      if (isMovie) finalType = "Movie";
    }

    try {
      const createData = {
        name,
        normalizedName,
        season,
        totalEpisodes: finalType === 'Movie' ? 0 : (totalEpisodes || 0),
        episodesWatched: finalType === 'Movie' ? 0 : (episodesWatched || 0),
        status: targetStatus,
        imageUrl: imageUrl || null,
        malId: malId ? Number(malId) : null,
        type: finalType,
        watchOrder: targetStatus === 'incomplete' ? 1 : null,
        droppedAt: targetStatus === 'dropped' ? new Date() : null,
        completedAt: targetStatus === 'completed' ? new Date() : null,
        airing: airing || false,
        broadcastDay: broadcastDay || null,
        broadcastTime: broadcastTime || null,
        broadcastTimezone: broadcastTimezone || null,
        broadcastString: broadcastString || null,
        airingStart: airingStart || null,
      };

      const newAnime = await withDeadlockRetry(() =>
        db.$transaction(async (tx) => {
          let createdAnime;
          try {
            createdAnime = await tx.anime.create({
              data: createData
            });
          } catch (error) {
            if (!isSchemaValidationError(error)) {
              throw error;
            }

            const fallbackCreateData = {
              ...createData,
              droppedAt: undefined,
              completedAt: undefined,
            };
            createdAnime = await tx.anime.create({
              data: fallbackCreateData
            });
          }

          if (targetStatus === 'incomplete') {
            await normalizeWatchingOrder(tx, { pinnedAnimeId: createdAnime.id });
            return tx.anime.findUniqueOrThrow({ where: { id: createdAnime.id } });
          }

          return createdAnime;
        }, WATCH_ORDER_TRANSACTION_OPTIONS)
      );

      return NextResponse.json(newAnime);
    } catch (error: unknown) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : 'Unknown error';
      const code =
        typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined;
      if (code === 'P2002') {
        return NextResponse.json(
          { error: "This anime is already in your watching list", type: "DUPLICATE_INCOMPLETE" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
