import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiCache } from '@/lib/cache';

/**
 * PUT /api/anime/reorder
 * Body: { items: [{ id: number, watchOrder: number }, ...] }
 * Updates watchOrder for all provided anime in a single transaction.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 });
    }

    // Batch update in a transaction for atomicity
    await db.$transaction(
      items.map((item: { id: number; watchOrder: number }) =>
        db.anime.update({
          where: { id: item.id },
          data: { watchOrder: item.watchOrder },
        })
      )
    );

    // Invalidate anime list caches
    apiCache.invalidatePrefix('anime:');

    return NextResponse.json({ success: true, updated: items.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
