import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeWatchingOrder } from '@/lib/watch-order';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';
import { normalizeAnimeName, extractSeasonNumber } from '@/lib/normalize';

function isDroppedAtValidationError(error: unknown) {
  return error instanceof Error && error.message.includes('Unknown argument `droppedAt`');
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const animeId = parseInt(id, 10);
    const body = await request.json();
    const { name, totalEpisodes, episodesWatched, status, watchOrder } = body;
    
    const currentAnime = await db.anime.findUnique({
      where: { id: animeId },
      select: { status: true, watchOrder: true, type: true, episodesWatched: true, totalEpisodes: true },
    });

    if (!currentAnime) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }

    // Validation checks for non-movies
    if (currentAnime.type !== 'Movie') {
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

    let updatedNormalizedName = undefined;
    let updatedSeason = undefined;
    if (name !== undefined) {
      updatedNormalizedName = normalizeAnimeName(name);
      updatedSeason = extractSeasonNumber(name);
    }

    const updateData = {
      name: name !== undefined ? name : undefined,
      normalizedName: updatedNormalizedName,
      season: updatedSeason,
      totalEpisodes: currentAnime.type === 'Movie' ? 0 : (totalEpisodes !== undefined ? totalEpisodes : undefined),
      episodesWatched: currentAnime.type === 'Movie' ? 0 : (episodesWatched !== undefined ? episodesWatched : undefined),
      status: status !== undefined ? status : undefined,
      watchOrder: resolvedWatchOrder !== undefined ? resolvedWatchOrder : undefined,
      droppedAt: nextDroppedAt,
    };

    const updatedAnime = await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        let nextAnime;
        try {
          nextAnime = await tx.anime.update({
            where: { id: animeId },
            data: updateData,
          });
        } catch (error) {
          if (!isDroppedAtValidationError(error)) {
            throw error;
          }

          const fallbackUpdateData = {
            ...updateData,
            droppedAt: undefined,
          };
          nextAnime = await tx.anime.update({
            where: { id: animeId },
            data: fallbackUpdateData,
          });
        }

        if (isStatusChanging) {
          await normalizeWatchingOrder(
            tx,
            status === 'incomplete' ? { pinnedAnimeId: animeId } : undefined
          );
          return tx.anime.findUniqueOrThrow({ where: { id: animeId } });
        }

        return nextAnime;
      }, WATCH_ORDER_TRANSACTION_OPTIONS)
    );

    return NextResponse.json(updatedAnime);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const animeId = parseInt(id, 10);

    const existingAnime = await db.anime.findUnique({
      where: { id: animeId },
      select: { status: true, watchOrder: true },
    });

    if (!existingAnime) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }

    const deletedAnime = await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        const removedAnime = await tx.anime.delete({
          where: { id: animeId }
        });

        if (existingAnime.status === 'incomplete' && existingAnime.watchOrder !== null) {
          await tx.anime.updateMany({
            where: {
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
