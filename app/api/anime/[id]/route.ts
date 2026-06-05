import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';
import { normalizeAnimeName, extractSeasonNumber } from '@/lib/normalize';
import { resolveSeason } from '@/lib/season-resolve';
import { getSession } from '@/lib/auth';

function isSchemaValidationError(error: unknown) {
  return error instanceof Error && (
    error.message.includes('Unknown argument `completedAt`') ||
    error.message.includes('Unknown argument `droppedAt`')
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.userId;

    const { id } = await params;
    const animeId = parseInt(id, 10);
    const body = await request.json();
    const { name, totalEpisodes, episodesWatched, status, watchOrder, season, part, normalizedName, type } = body;
    
    const currentAnime = await db.anime.findFirst({
      where: { id: animeId, userId },
      select: { status: true, watchOrder: true, type: true, episodesWatched: true, totalEpisodes: true, normalizedName: true, season: true, part: true },
    });

    if (!currentAnime) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }

    const targetType = type !== undefined ? type : currentAnime.type;

    // Validation checks for non-movies
    if (targetType !== 'Movie') {
      const targetEpisodesWatched = episodesWatched !== undefined ? episodesWatched : currentAnime.episodesWatched;
      const targetTotalEpisodes = totalEpisodes !== undefined ? totalEpisodes : currentAnime.totalEpisodes;

      if (targetEpisodesWatched < 0) {
        return NextResponse.json({ error: 'Watched episodes cannot be negative' }, { status: 400 });
      }
      if (targetTotalEpisodes < 0) {
        return NextResponse.json({ error: 'Total episodes cannot be negative' }, { status: 400 });
      }
      if (targetTotalEpisodes > 0 && targetEpisodesWatched > targetTotalEpisodes) {
        return NextResponse.json({ error: 'Watched episodes cannot exceed total episodes' }, { status: 400 });
      }
    }

    const isStatusChanging = status !== undefined && status !== currentAnime.status;

    let resolvedWatchOrder = watchOrder;
    if (isStatusChanging) {
      if (status === 'incomplete') {
        resolvedWatchOrder = watchOrder !== undefined ? watchOrder : 1;
      } else {
        resolvedWatchOrder = null;
      }
    }

    const nextDroppedAt =
      status === undefined ? undefined :
      status === 'dropped' ? new Date() :
      null;

    const nextCompletedAt =
      status === undefined ? undefined :
      status === 'completed' ? new Date() :
      null;

    const seasonWasExplicit = season !== undefined;
    let updatedNormalizedName = normalizedName !== undefined ? normalizedName : undefined;
    let updatedSeason = season !== undefined ? season : undefined;
    let updatedPart = part !== undefined ? part : undefined;
    if (name !== undefined) {
      if (updatedNormalizedName === undefined) {
        updatedNormalizedName = normalizeAnimeName(name);
      }
      if (updatedSeason === undefined) {
        updatedSeason = extractSeasonNumber(name);
      }
    }

    if (
      targetType === 'TV' &&
      (updatedNormalizedName !== undefined || updatedSeason !== undefined || updatedPart !== undefined || type !== undefined)
    ) {
      const effectiveNormalizedName = updatedNormalizedName ?? currentAnime.normalizedName;
      const effectiveSeason = updatedSeason ?? currentAnime.season;
      const effectivePart = updatedPart !== undefined ? updatedPart : currentAnime.part;

      const tvSiblings = await db.anime.findMany({
        where: {
          userId,
          normalizedName: effectiveNormalizedName,
          type: 'TV',
          id: { not: animeId },
        },
        select: { season: true, part: true },
      });

      const resolution = resolveSeason({
        type: 'TV',
        season: effectiveSeason,
        part: effectivePart,
        explicit: seasonWasExplicit,
        tvSiblings: tvSiblings.map((s) => ({ season: s.season, part: s.part })),
      });

      if (resolution.kind === 'collision') {
        const label =
          resolution.part != null
            ? `Season ${resolution.season} · Part ${resolution.part}`
            : `Season ${resolution.season}`;
        return NextResponse.json(
          { error: `${label} already exists for this franchise.` },
          { status: 409 }
        );
      }

      updatedSeason = resolution.season;
      updatedPart = resolution.part;
    }

    const updateData = {
      name: name !== undefined ? name : undefined,
      normalizedName: updatedNormalizedName,
      season: updatedSeason,
      part: targetType !== 'TV' ? null : updatedPart,
      type: type !== undefined ? type : undefined,
      totalEpisodes: targetType === 'Movie' ? 0 : (totalEpisodes !== undefined ? totalEpisodes : undefined),
      episodesWatched: targetType === 'Movie' ? 0 : (episodesWatched !== undefined ? episodesWatched : undefined),
      status: status !== undefined ? status : undefined,
      watchOrder: resolvedWatchOrder !== undefined ? resolvedWatchOrder : undefined,
      droppedAt: nextDroppedAt,
      completedAt: nextCompletedAt,
    };

    const updatedAnime = await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        if (isStatusChanging) {
          // 1. If moving OUT of incomplete, decrement watchOrder of all items that were after it
          if (currentAnime.status === 'incomplete' && currentAnime.watchOrder !== null) {
            await tx.anime.updateMany({
              where: {
                userId,
                status: 'incomplete',
                watchOrder: {
                  gt: currentAnime.watchOrder,
                },
              },
              data: {
                watchOrder: {
                  decrement: 1,
                },
              },
            });
          }

          // 2. If moving INTO incomplete, increment watchOrder of all existing incomplete items
          if (status === 'incomplete') {
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
        }

        let nextAnime;
        try {
          nextAnime = await tx.anime.update({
            where: { id: animeId },
            data: updateData,
          });
        } catch (error) {
          if (!isSchemaValidationError(error)) {
            throw error;
          }

          const fallbackUpdateData = {
            ...updateData,
            droppedAt: undefined,
            completedAt: undefined,
          };
          nextAnime = await tx.anime.update({
            where: { id: animeId },
            data: fallbackUpdateData,
          });
        }

        return nextAnime;
      }, WATCH_ORDER_TRANSACTION_OPTIONS)
    );

    return NextResponse.json(updatedAnime);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
    if (code === 'P2002') {
      return NextResponse.json(
        { error: "An anime with this same subtitle/slug and season already exists." },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.userId;

    const { id } = await params;
    const animeId = parseInt(id, 10);

    const existingAnime = await db.anime.findFirst({
      where: { id: animeId, userId },
      select: { status: true, watchOrder: true },
    });

    if (!existingAnime) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }

    const deletedAnime = await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        if (existingAnime.status === 'incomplete') {
          await tx.$queryRaw`
            SELECT "id"
            FROM "Anime"
            WHERE ("status" = 'incomplete' OR "id" = ${animeId}) AND "userId" = ${userId}
            ORDER BY "id"
            FOR UPDATE
          `;
        }

        const removedAnime = await tx.anime.delete({
          where: { id: animeId }
        });

        if (existingAnime.status === 'incomplete' && existingAnime.watchOrder !== null) {
          await tx.anime.updateMany({
            where: {
              userId,
              status: 'incomplete',
              watchOrder: {
                gt: existingAnime.watchOrder
              }
            },
            data: {
              watchOrder: {
                decrement: 1
              }
            }
          });
        }

        return removedAnime;
      }, WATCH_ORDER_TRANSACTION_OPTIONS)
    );

    return NextResponse.json(deletedAnime);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
