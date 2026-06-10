import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireEntitlement } from '@/lib/require-entitlement';
import { errorMessage } from '@/lib/api-error';
import { getBlockedUserIds } from '@/lib/blocks';

const PAGE_SIZE = 20;

// Users that [username] follows.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
    const meId = session.userId;

    const { username } = await params;
    const owner = await db.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: { id: true },
    });
    if (!owner) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    // Hide accounts the viewer is in a block relationship with (either direction).
    const blockedIds = await getBlockedUserIds(meId);
    const where = { followerId: owner.id, followingId: { notIn: blockedIds } };

    const [rows, total] = await Promise.all([
      db.follow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          following: {
            select: {
              id: true,
              username: true,
              name: true,
              bio: true,
              isPublic: true,
              _count: { select: { followers: true, animes: true } },
            },
          },
        },
      }),
      db.follow.count({ where }),
    ]);

    const users = rows.map((r) => r.following);
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
      animeCount: u._count.animes,
      isFollowing: followedSet.has(u.id),
      isSelf: u.id === meId,
    }));

    return NextResponse.json({
      data,
      pagination: { page, limit: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
