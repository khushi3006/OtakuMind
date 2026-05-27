import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';

async function resolveTarget(username: string) {
  const handle = username.trim().toLowerCase();
  return db.user.findUnique({ where: { username: handle }, select: { id: true } });
}

async function followerCount(userId: number) {
  return db.follow.count({ where: { followingId: userId } });
}

export async function POST(
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
    const target = await resolveTarget(username);
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (target.id === meId) {
      return NextResponse.json({ error: 'You cannot follow yourself' }, { status: 400 });
    }

    // Idempotent: a duplicate follow is a no-op.
    await db.follow.upsert({
      where: { followerId_followingId: { followerId: meId, followingId: target.id } },
      create: { followerId: meId, followingId: target.id },
      update: {},
    });

    return NextResponse.json({ isFollowing: true, followersCount: await followerCount(target.id) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
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
    const target = await resolveTarget(username);
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await db.follow.deleteMany({
      where: { followerId: meId, followingId: target.id },
    });

    return NextResponse.json({ isFollowing: false, followersCount: await followerCount(target.id) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
