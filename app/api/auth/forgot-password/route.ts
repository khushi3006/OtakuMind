import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';
import { generateResetToken, hashSecret, expiry, RESET_TTL_MS } from '@/lib/otp';
import { sendEmail } from '@/lib/email';
import { resetPasswordEmail } from '@/lib/email-templates';

const APP_URL = (process.env.APP_URL || 'https://otakumind.thekhushikumari.com').replace(/\/+$/, '');

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const user = await db.user.findUnique({ where: { email: normalizedEmail } });

    if (user) {
      const raw = generateResetToken();
      await db.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashSecret(raw), expiresAt: expiry(RESET_TTL_MS) },
      });
      const link = `${APP_URL}/reset-password?token=${raw}`;
      try {
        const { subject, html, text } = resetPasswordEmail(link);
        await sendEmail({ to: user.email, subject, html, text });
      } catch (e) {
        console.error('reset email failed:', e); // do not leak to client
      }
    }

    // Always generic — never reveal whether the email belongs to an account.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('forgot-password error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
