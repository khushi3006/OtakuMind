import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { refreshAniList, refreshBroadcast } from '@/lib/airing-cache';
import { errorMessage } from '@/lib/api-error';

// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when the env
// var is set. Hobby functions may run up to 60s; the Jikan loop below is bounded
// to fit that budget (take: 120 × 350ms ≈ 42s).
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Every malId any user is currently tracking as airing.
    const tracked = await db.anime.findMany({
      where: { airing: true, malId: { not: null } },
      select: { malId: true },
      distinct: ['malId'],
    });
    const malIds = [...new Set(tracked.map((t) => t.malId as number))].filter(Boolean);

    // AniList is batched + fast — refresh all tracked airing shows.
    let aniListUpdated = 0;
    try {
      aniListUpdated = await refreshAniList(malIds);
    } catch (e) {
      console.warn(`[cron] AniList refresh failed: ${errorMessage(e)}`);
    }

    // Jikan is slow — refresh the oldest-synced subset that fits the time budget.
    const oldest = await db.airingCache.findMany({
      orderBy: { syncedAt: 'asc' },
      take: 120,
      select: { malId: true },
    });
    let broadcastUpdated = 0;
    try {
      broadcastUpdated = await refreshBroadcast(oldest.map((o) => o.malId));
    } catch (e) {
      console.warn(`[cron] Jikan refresh failed: ${errorMessage(e)}`);
    }

    return NextResponse.json({ ok: true, tracked: malIds.length, aniListUpdated, broadcastUpdated });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
