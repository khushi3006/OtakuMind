import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';
import { extractSeasonNumber, extractPartNumber } from '@/lib/normalize';
import { resolveFranchise, findFranchiseRows, parkRows, applyFinalSeasons } from '@/lib/franchise-resolve';
import { planSeasons } from '@/lib/season-reassign';
import { requireEntitlement } from '@/lib/require-entitlement';

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
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
    const userId = session.userId;

    const { id } = await params;
    const animeId = parseInt(id, 10);
    const body = await request.json();
    const { name, totalEpisodes, episodesWatched, status, watchOrder, season, part, normalizedName, type, malId } = body;

    const currentAnime = await db.anime.findFirst({
      where: { id: animeId, userId },
      select: { status: true, watchOrder: true, type: true, episodesWatched: true, totalEpisodes: true, normalizedName: true, season: true, part: true, name: true, malId: true },
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
    const partWasExplicit = part !== undefined;
    const explicitSlot = seasonWasExplicit || partWasExplicit;
    const userGaveSlug = normalizedName !== undefined;
    const nameOrMalChanged = name !== undefined || malId !== undefined;

    // Resolve the franchise slug for this edit. An explicit slug edit is honoured
    // verbatim; a name/malId change re-resolves via MAL relations (may hit Jikan,
    // so do it before the transaction). Otherwise keep the row's current slug.
    let targetSlug = currentAnime.normalizedName;
    let memberMalIds: number[] = [];
    if (userGaveSlug) {
      targetSlug = normalizedName;
    } else if (nameOrMalChanged) {
      const effectiveName = name !== undefined ? name : currentAnime.name;
      const effectiveMalId =
        malId !== undefined ? (malId ? Number(malId) : null) : currentAnime.malId;
      const existingSlugRows = await db.anime.findMany({
        where: { userId },
        select: { normalizedName: true },
        distinct: ['normalizedName'],
      });
      const resolved = await resolveFranchise({
        userId,
        name: effectiveName,
        malId: effectiveMalId,
        existingSlugs: existingSlugRows.map((r) => r.normalizedName),
      });
      targetSlug = resolved.slug;
      memberMalIds = resolved.memberMalIds;
    }

    // The edited row's intended (season, part): explicit wins, else derived from a
    // new name, else unchanged.
    const intendedSeason =
      season !== undefined ? season
      : name !== undefined ? extractSeasonNumber(name)
      : currentAnime.season;
    const intendedPart =
      part !== undefined ? part
      : name !== undefined ? extractPartNumber(name)
      : currentAnime.part;

    // Run the franchise/season merge when the slug changes or (for a TV row) the
    // season/part/type changes. The merge converges the whole franchise on the
    // canonical slug and re-packs collision-free (season, part).
    const doMerge =
      userGaveSlug || nameOrMalChanged ||
      (targetType === 'TV' && (explicitSlot || type !== undefined));

    // Preserve prior behaviour: an EXPLICIT user (season, part) that clashes with a
    // genuine TV sibling under the target slug is reported, not silently renumbered.
    if (doMerge && targetType === 'TV' && explicitSlot) {
      const clash = await db.anime.findFirst({
        where: {
          userId,
          normalizedName: targetSlug,
          type: 'TV',
          season: intendedSeason,
          part: intendedPart,
          id: { not: animeId },
        },
        select: { id: true },
      });
      if (clash) {
        const label =
          intendedPart != null
            ? `Season ${intendedSeason} · Part ${intendedPart}`
            : `Season ${intendedSeason}`;
        return NextResponse.json(
          { error: `${label} already exists for this franchise.` },
          { status: 409 }
        );
      }
    }

    const updateData = {
      name: name !== undefined ? name : undefined,
      type: type !== undefined ? type : undefined,
      malId: malId !== undefined ? (malId ? Number(malId) : null) : undefined,
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

        // Apply the non-slug/non-season field updates to the edited row first.
        let nextAnime;
        try {
          nextAnime = await tx.anime.update({ where: { id: animeId }, data: updateData });
        } catch (error) {
          if (!isSchemaValidationError(error)) {
            throw error;
          }
          nextAnime = await tx.anime.update({
            where: { id: animeId },
            data: { ...updateData, droppedAt: undefined, completedAt: undefined },
          });
        }

        if (doMerge) {
          // Gather the franchise (always include the edited row), park every TV row
          // to a unique negative season, then assign collision-free final slots.
          const found = await findFranchiseRows(tx, userId, targetSlug, memberMalIds);
          const byId = new Map(
            found.map((r) => [r.id, { id: r.id, type: r.type, season: r.season, part: r.part }])
          );
          byId.set(animeId, { id: animeId, type: targetType, season: intendedSeason, part: intendedPart });
          const rows = [...byId.values()];

          await parkRows(tx, targetSlug, rows.map((r) => ({ id: r.id, type: r.type })));

          const planRows = rows.map((r) =>
            r.id === animeId ? { ...r, explicit: explicitSlot } : r
          );
          const tvIds = new Set(planRows.filter((r) => r.type === 'TV').map((r) => r.id));
          const plan = planSeasons(planRows);
          await applyFinalSeasons(tx, plan, tvIds);

          const a = plan.find((p) => p.id === animeId);
          return {
            ...nextAnime,
            normalizedName: targetSlug,
            season: a ? a.season : intendedSeason,
            part: targetType === 'TV' ? (a ? a.part : intendedPart) : null,
          };
        }

        // No merge: set slug/season/part directly on the edited row (no franchise
        // change — these resolve to the current values unless the row is non-TV).
        return tx.anime.update({
          where: { id: animeId },
          data: {
            normalizedName: targetSlug,
            season: intendedSeason,
            part: targetType === 'TV' ? intendedPart : null,
          },
        });
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
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
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
