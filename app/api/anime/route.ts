import { NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { refreshAniList } from '@/lib/airing-cache';
import { extractSeasonNumber, extractPartNumber } from '@/lib/normalize';
import { resolveFranchise, findFranchiseRows, parkRows, applyFinalSeasons } from '@/lib/franchise-resolve';
import { planSeasons } from '@/lib/season-reassign';
import type { Prisma } from '@/prisma/generated/client';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';
import { requireEntitlement } from '@/lib/require-entitlement';
import { enrichWithAiring } from '@/lib/anilist';

const ALLOWED_LIMITS = [20, 50, 100] as const;

function isSchemaValidationError(error: unknown) {
  return error instanceof Error && (
    error.message.includes('Unknown argument `completedAt`') ||
    error.message.includes('Unknown argument `droppedAt`')
  );
}

export async function GET(request: Request) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
    const userId = session.userId;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = ALLOWED_LIMITS.includes(rawLimit as (typeof ALLOWED_LIMITS)[number]) ? rawLimit : 20;

    const where: Prisma.AnimeWhereInput = { userId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { normalizedName: { contains: search, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.AnimeOrderByWithRelationInput[];
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

    // Enrich airing rows with the real next-episode number + exact air time from
    // AniList (cached, best-effort — never blocks or fails the list).
    const data = await enrichWithAiring(animes);

    const result = {
      data,
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
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
    const userId = session.userId;

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

    const desiredSeason = extractSeasonNumber(name);
    const desiredPart = extractPartNumber(name);

    // Determine the type up front: season numbering only applies to TV rows.
    let finalType = type || "TV";
    if (!type) {
      const isMovie = name.match(/\b(movie|film)\b/i) || (!name.match(/season/i) && !name.match(/episode/i) && !name.match(/s\d+/i) && !name.match(/part/i) && name.length > 0);
      if (isMovie) finalType = "Movie";
    }

    // 1. Check for exact duplicate by malId in ANY status for this user
    if (malId) {
      const duplicateByMalId = await db.anime.findFirst({
        where: {
          userId,
          malId: Number(malId)
        }
      });

      if (duplicateByMalId) {
        if (duplicateByMalId.status === 'incomplete') {
          return NextResponse.json(
            { error: "This anime is already in your watching list", type: "DUPLICATE_INCOMPLETE" },
            { status: 409 }
          );
        } else {
          return NextResponse.json(
            { 
              error: `This anime is in your ${duplicateByMalId.status} list`,
              type: "DUPLICATE_OTHER_STATUS",
              existingAnime: duplicateByMalId
            },
            { status: 409 }
          );
        }
      }
    }

    // 2. Resolve the canonical franchise slug via MAL relations (or local
    //    fallback). This runs BEFORE the transaction because it may call Jikan,
    //    and we must never hold a DB transaction open across the network. Any
    //    Jikan failure degrades to local string logic inside resolveFranchise,
    //    so the write still succeeds. memberMalIds lets the merge pull in existing
    //    franchise siblings even when their stored slug differs.
    const existingSlugRows = await db.anime.findMany({
      where: { userId },
      select: { normalizedName: true },
      distinct: ['normalizedName'],
    });
    const { slug, memberMalIds } = await resolveFranchise({
      userId,
      name,
      malId: malId ? Number(malId) : null,
      existingSlugs: existingSlugRows.map((r) => r.normalizedName),
    });

    try {
      const createData = {
        name,
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
        userId, // Assign to logged-in user
      };

      const newAnime = await withDeadlockRetry(() =>
        db.$transaction(async (tx) => {
          if (targetStatus === 'incomplete') {
            // Increment watchOrder of all existing incomplete items by 1 to make room at the top
            await tx.anime.updateMany({
              where: {
                userId,
                status: 'incomplete',
              },
              data: {
                watchOrder: {
                  increment: 1,
                },
              },
            });
          }

          // Phase A: pull existing franchise siblings under the canonical slug and
          // park their TV (season, part) at unique negatives so nothing blocks the
          // new row during the merge.
          const siblings = await findFranchiseRows(tx, userId, slug, memberMalIds);
          await parkRows(tx, slug, siblings);

          // Create the new row under the canonical slug. TV rows are created at a
          // parked sentinel season 0 (no other row holds 0 — existing TV are now
          // negative), so the insert can't trip the unique index; the real season
          // is assigned in Phase B.
          const createBase = {
            ...createData,
            normalizedName: slug,
            season: finalType === 'TV' ? 0 : desiredSeason,
            part: finalType === 'TV' ? desiredPart : null,
          };
          let createdAnime;
          try {
            createdAnime = await tx.anime.create({ data: createBase });
          } catch (error) {
            if (!isSchemaValidationError(error)) {
              throw error;
            }
            createdAnime = await tx.anime.create({
              data: { ...createBase, droppedAt: undefined, completedAt: undefined },
            });
          }

          // Phase B: assign collision-free final (season, part) across the whole
          // franchise (existing siblings + the new row).
          const rows = [
            ...siblings.map((s) => ({ id: s.id, type: s.type, season: s.season, part: s.part })),
            { id: createdAnime.id, type: finalType, season: desiredSeason, part: desiredPart },
          ];
          const tvIds = new Set(rows.filter((r) => r.type === 'TV').map((r) => r.id));
          const plan = planSeasons(rows);
          await applyFinalSeasons(tx, plan, tvIds);

          const finalAssignment = plan.find((p) => p.id === createdAnime.id);
          return {
            ...createdAnime,
            normalizedName: slug,
            season: finalAssignment ? finalAssignment.season : desiredSeason,
            part: finalType === 'TV' ? (finalAssignment ? finalAssignment.part : desiredPart) : null,
          };
        }, WATCH_ORDER_TRANSACTION_OPTIONS)
      );

      // Populate the shared airing cache for this show in the background so the
      // next list read is warm and the badge fills in within ~1s. Non-blocking.
      if (newAnime.malId) {
        const malId = newAnime.malId;
        after(async () => {
          try { await refreshAniList([malId]); } catch { /* best-effort */ }
        });
      }
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
