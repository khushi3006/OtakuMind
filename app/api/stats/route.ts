import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    // Use raw SQL for efficient distinct count instead of findMany + .length
    const countResult = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "normalizedName") as count 
      FROM "Anime" 
      WHERE status IN ('completed', 'incomplete')
    `;

    const slugsResult = await db.anime.findMany({
      select: { normalizedName: true },
      distinct: ['normalizedName'],
      orderBy: { normalizedName: 'asc' },
    });

    const result = {
      uniqueTotal: Number(countResult[0]?.count || 0),
      slugs: slugsResult.map(a => a.normalizedName),
    };

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
