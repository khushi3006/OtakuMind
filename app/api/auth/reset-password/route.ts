import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';
import { hashSecret } from '@/lib/otp';
import { sendEmail } from '@/lib/email';
import { passwordChangedEmail } from '@/lib/email-templates';

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();
    if (!token || !password) {
      return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashSecret(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 });
    }

    await db.$transaction([
      db.user.update({ where: { id: row.userId }, data: { password: hashPassword(password) } }),
      db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // Invalidate any other outstanding reset tokens for this user.
      db.passwordResetToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    const user = await db.user.findUnique({ where: { id: row.userId } });
    if (user) {
      try {
        const { subject, html, text } = passwordChangedEmail();
        await sendEmail({ to: user.email, subject, html, text });
      } catch (e) {
        console.error('password-changed email failed:', e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('reset-password error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
