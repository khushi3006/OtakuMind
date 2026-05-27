import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const meId = session.userId;

    const { username } = await params;
    const handle = username.trim().toLowerCase();

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

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isSelf = user.id === meId;
    const canViewList = isSelf || user.isPublic;

    // Whether the viewer follows this user.
    const follow = isSelf
      ? null
      : await db.follow.findUnique({
          where: { followerId_followingId: { followerId: meId, followingId: user.id } },
          select: { id: true },
        });

    // Anime counts per status (only surfaced when the list is viewable).
    const counts = { watching: 0, completed: 0, dropped: 0, total: 0 };
    if (canViewList) {
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
    }

    return NextResponse.json({
      profile: {
        id: user.id,
        username: user.username,
        name: user.name,
        bio: user.bio,
        isPublic: user.isPublic,
        createdAt: user.createdAt,
        followersCount: user._count.followers,
        followingCount: user._count.following,
        isSelf,
        isFollowing: Boolean(follow),
        canViewList,
        animeCounts: counts,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
