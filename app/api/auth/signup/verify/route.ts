import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { findAvailableUsername, slugifyUsername } from '@/lib/username';
import { errorCode, errorMessage } from '@/lib/api-error';
import { verifySecret, OTP_MAX_ATTEMPTS } from '@/lib/otp';
import { sendEmail } from '@/lib/email';
import { welcomeEmail } from '@/lib/email-templates';

export async function POST(request: Request) {
  try {
    const { email, code } = await request.json();
    if (!email || !code) {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const pending = await db.pendingSignup.findUnique({ where: { email: normalizedEmail } });
    if (!pending) {
      return NextResponse.json({ error: 'No pending signup found. Please start again.' }, { status: 404 });
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await db.pendingSignup.delete({ where: { email: normalizedEmail } });
      return NextResponse.json({ error: 'Code expired. Please request a new one.' }, { status: 400 });
    }
    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      await db.pendingSignup.delete({ where: { email: normalizedEmail } });
      return NextResponse.json({ error: 'Too many attempts. Please start again.' }, { status: 429 });
    }
    if (!verifySecret(String(code).trim(), pending.otpHash)) {
      await db.pendingSignup.update({
        where: { email: normalizedEmail },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 });
    }

    // Resolve the final username: keep the requested one if still free, else auto-generate.
    const isTaken = async (candidate: string) =>
      (await db.user.count({ where: { username: candidate } })) > 0;
    let finalUsername: string;
    if (pending.username && !(await isTaken(pending.username))) {
      finalUsername = pending.username;
    } else {
      const base = pending.name
        ? slugifyUsername(pending.name)
        : slugifyUsername(normalizedEmail.split('@')[0]);
      finalUsername = await findAvailableUsername(base, isTaken);
    }

    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        username: finalUsername,
        password: pending.passwordHash,
        name: pending.name,
      },
    });
    await db.pendingSignup.delete({ where: { email: normalizedEmail } });

    await setSessionCookie({ userId: user.id, email: user.email, name: user.name, username: user.username });

    // Best-effort welcome email — never block the signup response on it.
    try {
      const { subject, html, text } = welcomeEmail(user.name);
      await sendEmail({ to: user.email, subject, html, text });
    } catch (e) {
      console.error('welcome email failed:', e);
    }

    return NextResponse.json({
      message: 'Registered successfully',
      user: { id: user.id, email: user.email, name: user.name, username: user.username },
    });
  } catch (error) {
    if (errorCode(error) === 'P2002') {
      return NextResponse.json({ error: 'Email or username is already taken' }, { status: 409 });
    }
    console.error('signup/verify error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
