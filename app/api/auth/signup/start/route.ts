import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { isValidUsername } from '@/lib/username';
import { errorMessage } from '@/lib/api-error';
import { generateOtp, hashSecret, expiry, OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS } from '@/lib/otp';
import { sendEmail } from '@/lib/email';
import { signupOtpEmail } from '@/lib/email-templates';

export async function POST(request: Request) {
  try {
    const { email, password, name, username } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const requested = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (requested) {
      if (!isValidUsername(requested)) {
        return NextResponse.json(
          { error: 'Username must be 3-20 characters: lowercase letters, numbers, or underscores' },
          { status: 400 },
        );
      }
      if ((await db.user.count({ where: { username: requested } })) > 0) {
        return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
      }
    }

    if (await db.user.findUnique({ where: { email: normalizedEmail } })) {
      return NextResponse.json({ error: 'Email is already registered' }, { status: 409 });
    }

    // Resend cooldown — reject if a code was sent too recently for this email.
    const existing = await db.pendingSignup.findUnique({ where: { email: normalizedEmail } });
    if (existing && Date.now() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt.getTime())) / 1000);
      return NextResponse.json({ error: `Please wait ${wait}s before requesting a new code` }, { status: 429 });
    }

    const code = generateOtp();
    const data = {
      name: name || null,
      username: requested || null,
      passwordHash: hashPassword(password),
      otpHash: hashSecret(code),
      attempts: 0,
      expiresAt: expiry(OTP_TTL_MS),
      lastSentAt: new Date(),
    };
    await db.pendingSignup.upsert({
      where: { email: normalizedEmail },
      create: { email: normalizedEmail, ...data },
      update: data,
    });

    const { subject, html, text } = signupOtpEmail(code);
    await sendEmail({ to: normalizedEmail, subject, html, text });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('signup/start error:', error);
    return NextResponse.json({ error: errorMessage(error, 'Could not send verification code') }, { status: 500 });
  }
}
