// Verifies Apple / Google OpenID Connect identity tokens (RS256 + JWKS) using the
// Web Crypto API only — no extra dependencies, edge-runtime compatible, in the same
// spirit as lib/jwt.ts. Used by the social sign-in routes to authenticate the
// identity token a mobile client obtained from Apple/Google before issuing a session.

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

const APPLE_ISS = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const GOOGLE_ISS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

async function getJwks(url: string): Promise<Jwk[]> {
  const cached = jwksCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch signing keys (${res.status})`);
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache.set(url, { keys: data.keys, fetchedAt: Date.now() });
  return data.keys;
}

function base64UrlToString(b64url: string): string {
  let base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return atob(base64);
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const binary = base64UrlToString(b64url);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface VerifiedIdentity {
  /** Provider-stable user id (the token `sub` claim). */
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  raw: Record<string, unknown>;
}

interface VerifyOptions {
  jwksUrl: string;
  issuers: string[];
  /** Allowed `aud` values — the OAuth client id(s) that minted the token. */
  audiences: string[];
}

async function verifyToken(token: string, opts: VerifyOptions): Promise<VerifiedIdentity> {
  if (opts.audiences.length === 0) {
    throw new Error('No allowed audiences configured for this provider');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64UrlToString(headerB64)) as { alg?: string; kid?: string };
  const payload = JSON.parse(base64UrlToString(payloadB64)) as Record<string, any>;

  if (header.alg !== 'RS256') throw new Error(`Unsupported token algorithm: ${header.alg}`);
  if (!header.kid) throw new Error('Token is missing a key id');

  const keys = await getJwks(opts.jwksUrl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Token signing key not found');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);
  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature as BufferSource,
    signedData as BufferSource,
  );
  if (!isValid) throw new Error('Invalid token signature');

  // Standard OIDC claim checks.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now >= payload.exp) throw new Error('Token expired');
  if (typeof payload.iat === 'number' && payload.iat > now + 300) {
    throw new Error('Token issued in the future');
  }
  if (!opts.issuers.includes(payload.iss)) throw new Error('Invalid token issuer');

  const aud = payload.aud;
  const audienceOk = Array.isArray(aud)
    ? aud.some((a: string) => opts.audiences.includes(a))
    : opts.audiences.includes(aud);
  if (!audienceOk) throw new Error('Invalid token audience');

  if (!payload.sub) throw new Error('Token is missing a subject');

  return {
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: typeof payload.name === 'string' ? payload.name : undefined,
    raw: payload,
  };
}

/** Verify an Apple identity token. `audiences` = your app bundle id(s). */
export function verifyAppleToken(
  identityToken: string,
  audiences: string[],
): Promise<VerifiedIdentity> {
  return verifyToken(identityToken, {
    jwksUrl: APPLE_JWKS_URL,
    issuers: [APPLE_ISS],
    audiences,
  });
}

/** Verify a Google ID token. `audiences` = your Google OAuth client id(s). */
export function verifyGoogleToken(
  idToken: string,
  audiences: string[],
): Promise<VerifiedIdentity> {
  return verifyToken(idToken, {
    jwksUrl: GOOGLE_JWKS_URL,
    issuers: GOOGLE_ISS,
    audiences,
  });
}
