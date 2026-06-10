import { db } from '@/lib/db';

/**
 * Block relationships are enforced symmetrically: if either side has blocked the other, they should
 * not see each other in discovery, follower lists, or profiles. These helpers centralise that rule
 * so every social route applies it identically.
 */

/** Every user id in a block relationship with me, in EITHER direction (I blocked them, or they me). */
export async function getBlockedUserIds(meId: number): Promise<number[]> {
  const rows = await db.block.findMany({
    where: { OR: [{ blockerId: meId }, { blockedId: meId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<number>();
  for (const r of rows) {
    ids.add(r.blockerId === meId ? r.blockedId : r.blockerId);
  }
  return [...ids];
}

/** True if either user has blocked the other. Self is never blocked. */
export async function isBlockedEitherWay(a: number, b: number): Promise<boolean> {
  if (a === b) return false;
  const row = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}
