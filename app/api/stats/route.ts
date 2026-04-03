import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiCache } from '@/lib/cache';

export async function GET() {
  try {
    const result = await apiCache.getOrSet('stats', async () => {
      // Use raw SQL for efficient distinct count instead of findMany + .length
      const countResult = await db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT "normalizedName") as count 
        FROM "Anime" 
        WHERE status IN ('completed', 'incomplete')
      `;

      return {
        uniqueTotal: Number(countResult[0]?.count || 0),
      };
    }, 60); // 60 second TTL — stats change rarely

    const response = NextResponse.json(result);
    response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
