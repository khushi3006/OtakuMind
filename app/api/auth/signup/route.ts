import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, setSessionCookie } from '@/lib/auth';
import { findAvailableUsername, isValidUsername, slugifyUsername } from '@/lib/username';
import { errorCode, errorMessage } from '@/lib/api-error';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name, username } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Validate email format basic check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Email is already registered' }, { status: 409 });
    }

    // Resolve the public handle: validate an explicit choice, otherwise auto-generate.
    const isTaken = async (candidate: string) =>
      (await db.user.count({ where: { username: candidate } })) > 0;

    let finalUsername: string;
    const requested = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (requested) {
      if (!isValidUsername(requested)) {
        return NextResponse.json(
          { error: 'Username must be 3-20 characters: lowercase letters, numbers, or underscores' },
          { status: 400 }
        );
      }
      if (await isTaken(requested)) {
        return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
      }
      finalUsername = requested;
    } else {
      const base = name ? slugifyUsername(name) : slugifyUsername(normalizedEmail.split('@')[0]);
      finalUsername = await findAvailableUsername(base, isTaken);
    }

    // Hash password and create user
    const hashedPassword = hashPassword(password);
    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        username: finalUsername,
        password: hashedPassword,
        name: name || null,
      },
    });

    // Create session cookie
    const sessionPayload = { userId: user.id, email: user.email, name: user.name, username: user.username };
    await setSessionCookie(sessionPayload);

    return NextResponse.json({
      message: 'Registered successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
      },
    });
  } catch (error) {
    if (errorCode(error) === 'P2002') {
      return NextResponse.json({ error: 'Email or username is already taken' }, { status: 409 });
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
