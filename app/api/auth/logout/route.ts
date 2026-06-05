import { NextResponse } from 'next/server';
import { removeSessionCookie } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';

export async function POST() {
  try {
    await removeSessionCookie();
    return NextResponse.json({ message: 'Logged out successfully' });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
export async function GET() {
  // Allow GET logout for convenience or redirects
  try {
    await removeSessionCookie();
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
  } catch {
    return NextResponse.json({ message: 'Logged out' });
  }
}
