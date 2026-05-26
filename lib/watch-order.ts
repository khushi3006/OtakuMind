import { Prisma } from '@/prisma/generated/client';

type NormalizeOptions = {
  pinnedAnimeId?: number;
};

type WatchOrderItem = {
  id: number;
  watchOrder: number;
};

async function lockAnimeRows(
  tx: Prisma.TransactionClient,
  ids: number[]
) {
  if (ids.length === 0) {
    return;
  }

  const uniqueSortedIds = [...new Set(ids)].sort((a, b) => a - b);
  const idList = uniqueSortedIds.join(', ');

  await tx.$queryRawUnsafe(`
    SELECT "id"
    FROM "Anime"
    WHERE "id" IN (${idList})
    ORDER BY "id"
    FOR UPDATE
  `);
}

async function applyWatchOrderItems(
  tx: Prisma.TransactionClient,
  items: WatchOrderItem[]
) {
  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    if (!Number.isInteger(item.id) || !Number.isInteger(item.watchOrder)) {
      throw new Error('Invalid watch order payload');
    }
  }

  const sortedItems = [...items].sort((a, b) => a.id - b.id);
  const idList = sortedItems.map((item) => item.id).join(', ');
  const whenClauses = sortedItems
    .map((item) => `WHEN ${item.id} THEN ${item.watchOrder}`)
    .join(' ');

  await lockAnimeRows(tx, sortedItems.map((item) => item.id));

  await tx.$executeRawUnsafe(`
    UPDATE "Anime"
    SET "watchOrder" = CASE id
      ${whenClauses}
      ELSE "watchOrder"
    END
    WHERE id IN (${idList})
  `);
}

export async function normalizeWatchingOrder(
  tx: Prisma.TransactionClient,
  userId: number,
  options: NormalizeOptions = {}
) {
  await tx.$queryRaw`
    SELECT "id"
    FROM "Anime"
    WHERE "status" = 'incomplete' AND "userId" = ${userId}
    ORDER BY "id"
    FOR UPDATE
  `;

  const watchingAnimes = await tx.anime.findMany({
    where: { status: 'incomplete', userId },
    orderBy: [
      { watchOrder: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'asc' },
    ],
    select: { id: true, watchOrder: true },
  });

  if (watchingAnimes.length === 0) {
    return;
  }

  const normalizedIds = options.pinnedAnimeId === undefined
    ? watchingAnimes.map((anime) => anime.id)
    : [
        options.pinnedAnimeId,
        ...watchingAnimes
          .filter((anime) => anime.id !== options.pinnedAnimeId)
          .map((anime) => anime.id),
      ];

  const updatesNeeded: WatchOrderItem[] = [];
  normalizedIds.forEach((id, index) => {
    const expectedOrder = index + 1;
    const anime = watchingAnimes.find((a) => a.id === id);
    if (!anime || anime.watchOrder !== expectedOrder) {
      updatesNeeded.push({ id, watchOrder: expectedOrder });
    }
  });

  if (updatesNeeded.length > 0) {
    await applyWatchOrderItems(tx, updatesNeeded);
  }
}

export async function updateWatchOrderItems(
  tx: Prisma.TransactionClient,
  items: WatchOrderItem[]
) {
  await applyWatchOrderItems(tx, items);
}
