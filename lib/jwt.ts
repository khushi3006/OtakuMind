// Secure stateless JWT signature & verification using standard Web Crypto API.
// This file does not import any Node.js or Next.js specific libraries, making it
// 100% compatible with the Next.js Edge Runtime / Middleware.

const encoder = new TextEncoder();

// Sessions are signed with this HMAC key. In production it MUST come from the environment —
// refuse to fall back to a committed default, which would let anyone forge a session for any
// user (full account takeover). The dev-only fallback keeps local development frictionless.
// Resolved lazily (at sign/verify time, not module load) so a build / preview without the secret
// still compiles — the throw only fires when something actually tries to use a session.
// NOTE: setting/rotating JWT_SECRET invalidates all existing sessions (everyone is logged out).
function getJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Refusing to sign/verify sessions with an insecure default in production.');
  }
  return 'c59a35e8093d9b4dbcb9367d32c918a287fa3f7902d2948ca240f951e73e9112';
}

async function getCryptoKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(getJwtSecret()),
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

export interface SessionPayload {
  /** Owner of the session. */
  userId: number;
  /** Unix-seconds expiry, stamped by signJWT. */
  exp?: number;
  /** Other claims carried in the token (email, name, username, …). */
  [key: string]: unknown;
}

export async function signJWT(payload: SessionPayload, expiresInDays = 7): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInDays * 24 * 60 * 60;
  const fullPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await getCryptoKey();
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

export async function verifyJWT(token: string): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const data = `${header}.${payload}`;

    const key = await getCryptoKey();
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

    const decodedPayload = JSON.parse(base64UrlDecode(payload)) as SessionPayload;

    // Check expiration
    if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
      return null;
    }

    return decodedPayload;
  } catch {
    return null;
  }
}
