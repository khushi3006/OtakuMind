import { db } from '@/lib/db';

/**
 * The viewer's follow relationship with a profile owner, in both directions.
 */
export type FollowState = {
  /** The viewer follows the owner. */
  isFollowing: boolean;
  /** The owner follows the viewer back. */
  isFollowedBy: boolean;
};

/**
 * Resolve both directed follow edges between the viewer and a profile owner in a
 * single query. Returns no edges when viewing your own profile (no DB hit).
 */
export async function getFollowState(meId: number, ownerId: number): Promise<FollowState> {
  if (meId === ownerId) {
    return { isFollowing: false, isFollowedBy: false };
  }
  const edges = await db.follow.findMany({
    where: {
      OR: [
        { followerId: meId, followingId: ownerId },
        { followerId: ownerId, followingId: meId },
      ],
    },
    select: { followerId: true },
  });
  let isFollowing = false;
  let isFollowedBy = false;
  for (const e of edges) {
    // The OR above can only match these two directed pairs, so the follower id
    // alone disambiguates the direction.
    if (e.followerId === meId) isFollowing = true;
    else isFollowedBy = true;
  }
  return { isFollowing, isFollowedBy };
}

/**
 * A profile's lists are viewable when it's your own profile, the profile is
 * public, or you and the owner follow each other (mutual follow). Following is
 * instant and unapproved, so a one-way follow is deliberately NOT enough — that
 * would let anyone self-grant access and make `isPublic` meaningless.
 */
export function canViewList(opts: {
  isSelf: boolean;
  isPublic: boolean;
  isFollowing: boolean;
  isFollowedBy: boolean;
}): boolean {
  return opts.isSelf || opts.isPublic || (opts.isFollowing && opts.isFollowedBy);
}
