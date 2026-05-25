import { pbkdf2Sync, randomBytes } from 'crypto';
import { cookies } from 'next/headers';

const ITERATIONS = 10000;
const KEY_LEN = 64;
const DIGEST = 'sha512';
const COOKIE_NAME = 'session';

// Secure fallback secret in development if process.env.JWT_SECRET is missing.
const JWT_SECRET = process.env.JWT_SECRET || 'c59a35e8093d9b4dbcb9367d32c918a287fa3f7902d2948ca240f951e73e9112';

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
// 2. Web Crypto API-based Stateless JWT (Middleware & Edge Compatible)
// -------------------------------------------------------------
const encoder = new TextEncoder();

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// Base64Url Encoding helper
function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Base64Url Decoding helper
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

export async function signJWT(payload: any, expiresInDays = 7): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInDays * 24 * 60 * 60;
  const fullPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await getCryptoKey(JWT_SECRET);
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

export async function verifyJWT(token: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const data = `${header}.${payload}`;

    const key = await getCryptoKey(JWT_SECRET);
    const sigBuffer = Uint8Array.from(
      base64UrlDecode(signature),
      c => c.charCodeAt(0)
    );

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuffer,
      encoder.encode(data)
    );

    if (!isValid) return null;

    const decodedPayload = JSON.parse(base64UrlDecode(payload));
    
    // Check expiration
    if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
      return null;
    }

    return decodedPayload;
  } catch (error) {
    return null;
  }
}

// -------------------------------------------------------------
// 3. Next.js Cookie Session Management Helpers
// -------------------------------------------------------------
export async function getSession(request?: Request): Promise<any | null> {
  let token: string | undefined;

  if (request) {
    // If request is provided, read cookies header (useful in Middleware/API routes)
    const cookieHeader = request.headers.get('cookie') || '';
    const cookiesList = cookieHeader.split(';').reduce((acc: any, c) => {
      const [key, val] = c.trim().split('=');
      if (key) acc[key] = val;
      return acc;
    }, {});
    token = cookiesList[COOKIE_NAME];
  } else {
    // Else, use next/headers cookies() (for Server Components/Actions/API routes)
    const cookieStore = await cookies();
    token = cookieStore.get(COOKIE_NAME)?.value;
  }

  if (!token) return null;
  return verifyJWT(token);
}

export async function setSessionCookie(payload: any) {
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
