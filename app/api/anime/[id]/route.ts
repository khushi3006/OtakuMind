import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiCache } from '@/lib/cache';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const animeId = parseInt(id, 10);
    const body = await request.json();
    const { episodesWatched, status } = body;

    const updatedAnime = await db.anime.update({
      where: { id: animeId },
      data: {
        episodesWatched: episodesWatched !== undefined ? episodesWatched : undefined,
        status: status !== undefined ? status : undefined,
      }
    });

    // Invalidate caches — anime lists and stats
    apiCache.invalidatePrefix('anime:');
    if (status !== undefined) {
      apiCache.invalidate('stats');
    }

    return NextResponse.json(updatedAnime);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const animeId = parseInt(id, 10);

    const deletedAnime = await db.anime.delete({
      where: { id: animeId }
    });

    // Invalidate all caches
    apiCache.invalidatePrefix('anime:');
    apiCache.invalidate('stats');

    return NextResponse.json(deletedAnime);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
