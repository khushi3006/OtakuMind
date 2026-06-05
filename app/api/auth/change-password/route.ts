import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, verifyPassword, hashPassword } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';

export async function POST(request: Request) {
  try {
    const session = await getSession(request);

    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current password and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters long' }, { status: 400 });
    }

    // Retrieve user from database
    const user = await db.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const isCurrentValid = verifyPassword(currentPassword, user.password);
    if (!isCurrentValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Update with new password hash
    const newHashedPassword = hashPassword(newPassword);
    await db.user.update({
      where: { id: session.userId },
      data: { password: newHashedPassword },
    });

    return NextResponse.json({ message: 'Password changed successfully' });
  } catch (error: unknown) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
