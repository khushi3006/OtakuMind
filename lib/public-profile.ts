import { db } from '@/lib/db';
import type { Prisma } from '@/prisma/generated/client';

/**
 * Anonymous-viewer profile data for the server-rendered public profile page
 * (SEO/LLM crawlers don't log in). Visibility collapses to `isPublic` — an
 * anonymous viewer is never self, never a mutual follower, and has no blocks.
 * Reads the DB directly; the session-gated API routes are untouched.
 */

export type PublicAnime = {
  id: number;
  name: string;
  season: number;
  part: number | null;
  type: string;
  episodesWatched: number;
  totalEpisodes: number;
  imageUrl: string | null;
};

export type PublicLists = {
  watching: PublicAnime[];
  completed: PublicAnime[];
  dropped: PublicAnime[];
};

export type PublicProfile = {
  username: string;
  name: string | null;
  bio: string | null;
  isPublic: boolean;
  createdAt: Date;
  followersCount: number;
  followingCount: number;
  counts: { watching: number; completed: number; dropped: number; total: number };
  /** First page of each list; null when the profile is private. */
  lists: PublicLists | null;
};

/** Titles rendered per status section on the anonymous view. */
export const PUBLIC_SECTION_LIMIT = 24;

const ANIME_SELECT = {
  id: true,
  name: true,
  season: true,
  part: true,
  type: true,
  episodesWatched: true,
  totalEpisodes: true,
  imageUrl: true,
} as const;

async function listFor(userId: number, status: string): Promise<PublicAnime[]> {
  let orderBy: Prisma.AnimeOrderByWithRelationInput[];
  if (status === 'completed') {
    orderBy = [{ completedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
  } else if (status === 'incomplete') {
    orderBy = [{ watchOrder: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
  } else {
    orderBy = [{ droppedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
  }
  try {
    return await db.anime.findMany({
      where: { userId, status },
      orderBy,
      take: PUBLIC_SECTION_LIMIT,
      select: ANIME_SELECT,
    });
  } catch {
    // Same guard as the API routes: environments whose DB predates the
    // completedAt/droppedAt columns can't order by them.
    return db.anime.findMany({
      where: { userId, status },
      orderBy: { createdAt: 'desc' },
      take: PUBLIC_SECTION_LIMIT,
      select: ANIME_SELECT,
    });
  }
}

export async function getPublicProfile(handle: string): Promise<PublicProfile | null> {
  const user = await db.user.findUnique({
    where: { username: handle },
    select: {
      id: true,
      username: true,
      name: true,
      bio: true,
      isPublic: true,
      createdAt: true,
      _count: { select: { followers: true, following: true } },
    },
  });
  if (!user) return null;

  const counts = { watching: 0, completed: 0, dropped: 0, total: 0 };
  let lists: PublicLists | null = null;

  if (user.isPublic) {
    const grouped = await db.anime.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: { _all: true },
    });
    for (const g of grouped) {
      const n = g._count._all;
      if (g.status === 'incomplete') counts.watching = n;
      else if (g.status === 'completed') counts.completed = n;
      else if (g.status === 'dropped') counts.dropped = n;
    }
    counts.total = counts.watching + counts.completed + counts.dropped;

    const [watching, completed, dropped] = await Promise.all([
      listFor(user.id, 'incomplete'),
      listFor(user.id, 'completed'),
      listFor(user.id, 'dropped'),
    ]);
    lists = { watching, completed, dropped };
  }

  return {
    username: user.username,
    name: user.name,
    bio: user.bio,
    isPublic: user.isPublic,
    createdAt: user.createdAt,
    followersCount: user._count.followers,
    followingCount: user._count.following,
    counts,
    lists,
  };
}
