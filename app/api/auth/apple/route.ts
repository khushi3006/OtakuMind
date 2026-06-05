import { NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth';
import { verifyAppleToken } from '@/lib/oauth-verify';
import { upsertOAuthUser } from '@/lib/oauth-user';
import { errorCode, errorMessage } from '@/lib/api-error';

// Allowed token audiences = the app's Apple client id(s) (the iOS bundle id).
// Override/extend via the APPLE_CLIENT_ID env var (comma-separated).
const APPLE_AUDIENCES = (process.env.APPLE_CLIENT_ID || 'com.otakumind.app')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

interface AppleBody {
  identityToken?: string;
  user?: string;
  email?: string;
  fullName?: { givenName?: string; familyName?: string };
}

export async function POST(request: Request) {
  try {
    const { identityToken, fullName, email: bodyEmail } = (await request.json()) as AppleBody;

    if (!identityToken) {
      return NextResponse.json({ error: 'Missing Apple identity token' }, { status: 400 });
    }

    const claims = await verifyAppleToken(identityToken, APPLE_AUDIENCES).catch(() => null);
    if (!claims) {
      return NextResponse.json({ error: 'Invalid Apple identity token' }, { status: 401 });
    }

    // The verified token carries `email` on every sign-in; the request body
    // `email` is a fallback for the very first authorization only.
    const email = (claims.email || bodyEmail || '').toLowerCase().trim();
    if (!email) {
      return NextResponse.json(
        { error: 'Apple did not provide an email for this account' },
        { status: 400 },
      );
    }

    // Apple only sends the name once (first authorization), via the request body.
    const nameFromApple =
      fullName && (fullName.givenName || fullName.familyName)
        ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ')
        : claims.name ?? null;

    const user = await upsertOAuthUser({ email, name: nameFromApple });

    await setSessionCookie({
      userId: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
    });

    return NextResponse.json({
      message: 'Signed in with Apple',
      user: { id: user.id, email: user.email, name: user.name, username: user.username },
    });
  } catch (error) {
    if (errorCode(error) === 'P2002') {
      return NextResponse.json({ error: 'Account already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
