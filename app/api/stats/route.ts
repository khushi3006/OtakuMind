import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.userId;

    // Use raw SQL for efficient distinct count instead of findMany + .length
    const countResult = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "normalizedName") as count 
      FROM "Anime" 
      WHERE status IN ('completed', 'incomplete') AND "userId" = ${userId}
    `;

    const slugsResult = await db.anime.findMany({
      where: { userId },
      select: { normalizedName: true },
      distinct: ['normalizedName'],
      orderBy: { normalizedName: 'asc' },
    });

    const result = {
      uniqueTotal: Number(countResult[0]?.count || 0),
      slugs: slugsResult.map(a => a.normalizedName),
    };

    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
