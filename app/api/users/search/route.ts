import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';
import type { Prisma } from '@/prisma/generated/client';

const PAGE_SIZE = 20;

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const meId = session.userId;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    const where: Prisma.UserWhereInput = { NOT: { id: meId } };
    if (q) {
      where.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          name: true,
          bio: true,
          isPublic: true,
          _count: { select: { followers: true, following: true, animes: true } },
        },
        orderBy: [{ username: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.user.count({ where }),
    ]);

    // Resolve which of the returned users the viewer already follows.
    const ids = users.map((u) => u.id);
    const followed = ids.length
      ? await db.follow.findMany({
          where: { followerId: meId, followingId: { in: ids } },
          select: { followingId: true },
        })
      : [];
    const followedSet = new Set(followed.map((f) => f.followingId));

    const data = users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      bio: u.bio,
      isPublic: u.isPublic,
      followersCount: u._count.followers,
      followingCount: u._count.following,
      animeCount: u._count.animes,
      isFollowing: followedSet.has(u.id),
    }));

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit: PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
