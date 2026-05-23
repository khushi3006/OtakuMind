import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function POST() {
  try {
    // Find all incomplete anime with a linked malId
    const incompleteAnimes = await db.anime.findMany({
      where: {
        status: 'incomplete',
        malId: { not: null },
      },
    });

    if (incompleteAnimes.length === 0) {
      return NextResponse.json({ message: 'No incomplete anime to sync.', syncedCount: 0 });
    }

    let syncedCount = 0;
    let errorCount = 0;

    for (const anime of incompleteAnimes) {
      if (!anime.malId) continue;

      try {
        // Respect Jikan rate limits (max 3 requests per second)
        await delay(400);

        const res = await fetch(`https://api.jikan.moe/v4/anime/${anime.malId}`);
        
        if (res.status === 429) {
          // Rate limited, wait longer and retry once
          await delay(3000);
          const retryRes = await fetch(`https://api.jikan.moe/v4/anime/${anime.malId}`);
          if (!retryRes.ok) throw new Error(`HTTP ${retryRes.status} on retry`);
          
          const json = await retryRes.json();
          await updateAnimeAiringInfo(anime.id, json.data);
          syncedCount++;
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = await res.json();
        await updateAnimeAiringInfo(anime.id, json.data);
        syncedCount++;

      } catch (err) {
        console.error(`Failed to sync anime ID ${anime.id} (${anime.name}):`, err);
        errorCount++;
      }
    }

    return NextResponse.json({
      message: `Sync completed successfully.`,
      syncedCount,
      errorCount,
      totalChecked: incompleteAnimes.length
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function updateAnimeAiringInfo(id: number, data: any) {
  if (!data) return;

  const broadcast = data.broadcast || {};
  await db.anime.update({
    where: { id },
    data: {
      airing: data.airing || false,
      broadcastDay: broadcast.day || null,
      broadcastTime: broadcast.time || null,
      broadcastTimezone: broadcast.timezone || null,
      broadcastString: broadcast.string || null,
    },
  });
}
