import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeWatchingOrder } from '@/lib/watch-order';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';
import { normalizeAnimeName, extractSeasonNumber } from '@/lib/normalize';
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
    const { name, totalEpisodes, episodesWatched, status, watchOrder, season, normalizedName, type } = body;
    
    const currentAnime = await db.anime.findFirst({
      where: { id: animeId, userId },
      select: { status: true, watchOrder: true, type: true, episodesWatched: true, totalEpisodes: true, normalizedName: true, season: true },
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

    let updatedNormalizedName = normalizedName !== undefined ? normalizedName : undefined;
    let updatedSeason = season !== undefined ? season : undefined;
    if (name !== undefined) {
      if (updatedNormalizedName === undefined) {
        updatedNormalizedName = normalizeAnimeName(name);
      }
      if (updatedSeason === undefined) {
        updatedSeason = extractSeasonNumber(name);
      }
    }

    // Resolve (normalizedName, season) collisions the same way POST /api/anime does.
    // A franchise's movies (and re-slugged seasons) all normalize to season 1, so giving
    // a movie the shared franchise slug collides with the existing season-1 row — or with
    // another movie already filed under that slug. Keep the shared slug and bump this row to
    // the next free season number; the UI renders "Movie" regardless of the number
    // (see formatSeasonText), so this disambiguator stays invisible while still satisfying
    // @@unique([userId, normalizedName, season]).
    if (updatedNormalizedName !== undefined || updatedSeason !== undefined) {
      const effectiveNormalizedName = updatedNormalizedName ?? currentAnime.normalizedName;
      const effectiveSeason = updatedSeason ?? currentAnime.season;

      const collision = await db.anime.findFirst({
        where: {
          userId,
          normalizedName: effectiveNormalizedName,
          season: effectiveSeason,
          id: { not: animeId },
        },
        select: { id: true },
      });

      if (collision) {
        const siblings = await db.anime.findMany({
          where: {
            userId,
            normalizedName: effectiveNormalizedName,
            id: { not: animeId },
          },
          select: { season: true },
        });
        const maxSeason = siblings.reduce((max, curr) => Math.max(max, curr.season), 0);
        updatedSeason = maxSeason + 1;
      }
    }

    const updateData = {
      name: name !== undefined ? name : undefined,
      normalizedName: updatedNormalizedName,
      season: updatedSeason,
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
