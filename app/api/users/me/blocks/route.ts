import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireEntitlement } from '@/lib/require-entitlement';
import { errorMessage } from '@/lib/api-error';

// The accounts the current user has blocked, for the "Blocked Accounts" management screen.
export async function GET(request: Request) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const meId = gate.session.userId;

    const rows = await db.block.findMany({
      where: { blockerId: meId },
      orderBy: { createdAt: 'desc' },
      select: {
        blocked: { select: { id: true, username: true, name: true, isPublic: true } },
      },
    });

    const data = rows.map((r) => ({
      id: r.blocked.id,
      username: r.blocked.username,
      name: r.blocked.name,
      isPublic: r.blocked.isPublic,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
