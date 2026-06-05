import { pbkdf2Sync, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { signJWT, verifyJWT, type SessionPayload } from './jwt';

const ITERATIONS = 10000;
const KEY_LEN = 64;
const DIGEST = 'sha512';
const COOKIE_NAME = 'session';

// -------------------------------------------------------------
// 1. Password Hashing (using Node.js crypto)
// -------------------------------------------------------------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const verifyHash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
    return hash === verifyHash;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------
// 2. Next.js Cookie Session Management Helpers
// -------------------------------------------------------------
export async function getSession(request?: Request): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (request) {
    // If request is provided, read cookies header (useful in Middleware/API routes)
    const cookieHeader = request.headers.get('cookie') || '';
    const cookiesList = cookieHeader.split(';').reduce((acc: Record<string, string | undefined>, c) => {
      const [key, val] = c.trim().split('=');
      if (key) acc[key] = val;
      return acc;
    }, {} as Record<string, string | undefined>);
    token = cookiesList[COOKIE_NAME];
  } else {
    // Else, use next/headers cookies() (for Server Components/Actions/API routes)
    const cookieStore = await cookies();
    token = cookieStore.get(COOKIE_NAME)?.value;
  }

  if (!token) return null;
  return verifyJWT(token);
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await signJWT(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

export async function removeSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0, // Expire immediately
  });
}
