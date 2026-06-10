import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireEntitlement } from '@/lib/require-entitlement';
import { errorMessage } from '@/lib/api-error';

async function resolveTarget(username: string) {
  const handle = username.trim().toLowerCase();
  return db.user.findUnique({ where: { username: handle }, select: { id: true } });
}

// Block a user. Blocking also tears down any follow edges in either direction so the two accounts
// fully disconnect. Idempotent.
export async function POST(request: Request, { params }: { params: Promise<{ username: string }> }) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const meId = gate.session.userId;

    const { username } = await params;
    const target = await resolveTarget(username);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (target.id === meId) {
      return NextResponse.json({ error: 'You cannot block yourself' }, { status: 400 });
    }

    await db.$transaction([
      db.block.upsert({
        where: { blockerId_blockedId: { blockerId: meId, blockedId: target.id } },
        create: { blockerId: meId, blockedId: target.id },
        update: {},
      }),
      db.follow.deleteMany({
        where: {
          OR: [
            { followerId: meId, followingId: target.id },
            { followerId: target.id, followingId: meId },
          ],
        },
      }),
    ]);

    return NextResponse.json({ isBlocked: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// Unblock a user.
export async function DELETE(request: Request, { params }: { params: Promise<{ username: string }> }) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const meId = gate.session.userId;

    const { username } = await params;
    const target = await resolveTarget(username);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    await db.block.deleteMany({ where: { blockerId: meId, blockedId: target.id } });

    return NextResponse.json({ isBlocked: false });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
