import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireEntitlement } from '@/lib/require-entitlement';
import { errorMessage } from '@/lib/api-error';
import { isBlockedEitherWay } from '@/lib/blocks';

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
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
    const meId = session.userId;

    const { username } = await params;
    const target = await resolveTarget(username);
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (target.id === meId) {
      return NextResponse.json({ error: 'You cannot follow yourself' }, { status: 400 });
    }
    // Can't follow someone you've blocked, or who has blocked you.
    if (await isBlockedEitherWay(meId, target.id)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
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
