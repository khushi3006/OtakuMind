import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { refreshAniList } from '@/lib/airing-cache';
import { errorMessage } from '@/lib/api-error';

// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when the env
// var is set. AniList is batched (≤50 ids/req), so refreshing every tracked show
// plus the oldest-synced rows is a handful of fast requests.
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
    const trackedIds = tracked.map((t) => t.malId as number).filter(Boolean);

    // Also refresh the oldest-synced cache rows so finished/stale shows get
    // re-evaluated and their cover art kept current (cheap now that everything —
    // next-episode, broadcast, cover — comes from one batched upstream).
    const oldest = await db.airingCache.findMany({
      orderBy: { syncedAt: 'asc' },
      take: 500,
      select: { malId: true },
    });
    const malIds = [...new Set([...trackedIds, ...oldest.map((o) => o.malId)])].filter(Boolean);

    let aniListUpdated = 0;
    try {
      aniListUpdated = await refreshAniList(malIds);
    } catch (e) {
      console.warn(`[cron] AniList refresh failed: ${errorMessage(e)}`);
    }

    return NextResponse.json({ ok: true, tracked: trackedIds.length, refreshed: malIds.length, aniListUpdated });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
