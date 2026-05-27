import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';
import type { Prisma } from '@/prisma/generated/client';

const ALLOWED_LIMITS = [20, 50, 100] as const;
const VALID_STATUS = new Set(['incomplete', 'completed', 'dropped']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const meId = session.userId;

    const { username } = await params;
    const handle = username.trim().toLowerCase();

    const owner = await db.user.findUnique({
      where: { username: handle },
      select: { id: true, isPublic: true },
    });

    if (!owner) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isSelf = owner.id === meId;
    if (!isSelf && !owner.isPublic) {
      return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status') || 'incomplete';
    const status = VALID_STATUS.has(statusParam) ? statusParam : 'incomplete';
    const search = searchParams.get('search') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = ALLOWED_LIMITS.includes(rawLimit as (typeof ALLOWED_LIMITS)[number]) ? rawLimit : 20;

    const where: Prisma.AnimeWhereInput = { userId: owner.id, status };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { normalizedName: { contains: search, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.AnimeOrderByWithRelationInput[];
    if (status === 'completed') {
      orderBy = [{ completedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
    } else if (status === 'incomplete') {
      orderBy = [{ watchOrder: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    } else {
      orderBy = [{ droppedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
    }

    const [animes, total] = await Promise.all([
      db.anime.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          normalizedName: true,
          season: true,
          episodesWatched: true,
          totalEpisodes: true,
          status: true,
          imageUrl: true,
          malId: true,
          type: true,
          airing: true,
        },
      }),
      db.anime.count({ where }),
    ]);

    // Flag which of these the viewer already has (by malId or normalizedName+season),
    // so the UI can show "In your list" instead of "Add".
    const inMyList: Record<number, boolean> = {};
    if (!isSelf && animes.length > 0) {
      const malIds = animes.map((a) => a.malId).filter((v): v is number => v != null);
      const normalizedNames = animes.map((a) => a.normalizedName);
      const mine = await db.anime.findMany({
        where: {
          userId: meId,
          OR: [
            malIds.length ? { malId: { in: malIds } } : undefined,
            { normalizedName: { in: normalizedNames } },
          ].filter(Boolean) as Prisma.AnimeWhereInput[],
        },
        select: { malId: true, normalizedName: true, season: true },
      });
      const myMalIds = new Set(mine.map((m) => m.malId).filter((v) => v != null));
      const myPairs = new Set(mine.map((m) => `${m.normalizedName}::${m.season}`));
      for (const a of animes) {
        inMyList[a.id] =
          (a.malId != null && myMalIds.has(a.malId)) ||
          myPairs.has(`${a.normalizedName}::${a.season}`);
      }
    }

    const data = animes.map((a) => ({ ...a, inMyList: inMyList[a.id] || false }));

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
