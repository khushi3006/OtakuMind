import { NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth';
import { verifyGoogleToken } from '@/lib/oauth-verify';
import { upsertOAuthUser } from '@/lib/oauth-user';
import { errorCode, errorMessage } from '@/lib/api-error';

// Allowed token audiences = the app's Google OAuth client id(s). The native client
// obtains an idToken whose `aud` is the web client id (and/or iOS client id).
// Set GOOGLE_CLIENT_ID (comma-separated) — if unset, all tokens are rejected.
const GOOGLE_AUDIENCES = (process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

interface GoogleBody {
  idToken?: string;
}

export async function POST(request: Request) {
  try {
    const { idToken } = (await request.json()) as GoogleBody;

    if (!idToken) {
      return NextResponse.json({ error: 'Missing Google ID token' }, { status: 400 });
    }

    const claims = await verifyGoogleToken(idToken, GOOGLE_AUDIENCES).catch(() => null);
    if (!claims) {
      return NextResponse.json({ error: 'Invalid Google ID token' }, { status: 401 });
    }

    const email = (claims.email || '').toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ error: 'Google did not provide an email' }, { status: 400 });
    }
    if (claims.emailVerified === false) {
      return NextResponse.json({ error: 'Google email is not verified' }, { status: 401 });
    }

    const user = await upsertOAuthUser({ email, name: claims.name ?? null });

    await setSessionCookie({
      userId: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
    });

    return NextResponse.json({
      message: 'Signed in with Google',
      user: { id: user.id, email: user.email, name: user.name, username: user.username },
    });
  } catch (error) {
    if (errorCode(error) === 'P2002') {
      return NextResponse.json({ error: 'Account already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
