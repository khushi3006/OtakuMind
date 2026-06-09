import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';
import { computeEntitlement } from '@/lib/entitlement';

export async function GET(request: Request) {
  try {
    const session = await getSession(request);

    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    // Read fresh from the DB so fields added after the session was issued
    // (username, bio, isPublic) are always present and current.
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        bio: true,
        isPublic: true,
        createdAt: true,
        hasLifetime: true,
        grandfathered: true,
        _count: { select: { followers: true, following: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const entitlement = computeEntitlement({
      createdAt: user.createdAt,
      hasLifetime: user.hasLifetime,
      grandfathered: user.grandfathered,
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        bio: user.bio,
        isPublic: user.isPublic,
        followersCount: user._count.followers,
        followingCount: user._count.following,
      },
      entitlement,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
