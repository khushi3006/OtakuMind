import { NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';
import { refreshAniList, refreshBroadcast } from '@/lib/airing-cache';

/**
 * Legacy endpoint. The old 40s blocking Jikan loop is gone: airing data now lives
 * in the shared AiringCache (refreshed lazily on read + by a daily cron). This
 * handler just schedules a background refresh for the caller's incomplete shows
 * and returns immediately, so existing clients don't 404 during rollout.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const rows = await db.anime.findMany({
      where: { userId: session.userId, status: 'incomplete', malId: { not: null } },
      select: { malId: true },
    });
    const malIds = rows.map((r) => r.malId as number).filter(Boolean);
    if (malIds.length > 0) {
      after(async () => {
        try {
          await refreshAniList(malIds);
          await refreshBroadcast(malIds);
        } catch {
          /* best-effort */
        }
      });
    }
    return NextResponse.json({
      message: 'Refresh scheduled.',
      syncedCount: malIds.length,
      errorCount: 0,
      totalChecked: malIds.length,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
