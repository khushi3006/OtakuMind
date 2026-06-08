import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, removeSessionCookie } from '@/lib/auth';
import { isValidUsername } from '@/lib/username';
import { errorCode, errorMessage } from '@/lib/api-error';

const MAX_NAME = 60;
const MAX_BIO = 280;

export async function PUT(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.userId;

    const body = await request.json();
    const { name, username, bio, isPublic } = body;

    const data: Record<string, unknown> = {};

    if (username !== undefined) {
      const next = String(username).trim().toLowerCase();
      if (!isValidUsername(next)) {
        return NextResponse.json(
          { error: 'Username must be 3-20 characters: lowercase letters, numbers, or underscores' },
          { status: 400 }
        );
      }
      const clash = await db.user.findFirst({
        where: { username: next, NOT: { id: userId } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
      }
      data.username = next;
    }

    if (name !== undefined) {
      // A JSON `null` clears the field. Guard before String() — String(null) is the literal
      // "null", which is truthy and would be stored as a 4-char name instead of clearing it.
      const trimmed = name === null ? '' : String(name).trim();
      if (trimmed.length > MAX_NAME) {
        return NextResponse.json({ error: `Name must be at most ${MAX_NAME} characters` }, { status: 400 });
      }
      data.name = trimmed || null;
    }

    if (bio !== undefined) {
      // A JSON `null` clears the field. Guard before String() — String(null) is the literal
      // "null", which is truthy and would be stored as a 4-char bio instead of clearing it.
      const trimmed = bio === null ? '' : String(bio).trim();
      if (trimmed.length > MAX_BIO) {
        return NextResponse.json({ error: `Bio must be at most ${MAX_BIO} characters` }, { status: 400 });
      }
      data.bio = trimmed || null;
    }

    if (isPublic !== undefined) {
      data.isPublic = Boolean(isPublic);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
    }

    const user = await db.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        bio: true,
        isPublic: true,
        _count: { select: { followers: true, following: true } },
      },
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        bio: user.bio,
        isPublic: user.isPublic,
        followersCount: user._count.followers,
        followingCount: user._count.following,
      },
    });
  } catch (error) {
    if (errorCode(error) === 'P2002') {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      // Cascade deletes the user's Anime and Follow rows (onDelete: Cascade).
      await db.user.delete({ where: { id: session.userId } });
    } catch (error) {
      // P2025 = record already gone. Treat delete as idempotent and fall through
      // so we still clear the cookie and return success.
      if (errorCode(error) !== 'P2025') throw error;
    }

    await removeSessionCookie();
    return NextResponse.json({ message: 'Account deleted' });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}