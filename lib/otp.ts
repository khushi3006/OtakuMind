import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** 6-digit numeric code, zero-padded, as a string. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** 32-byte hex token for reset links. */
export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

/** Stable hash for storing OTPs/tokens at rest (never store the raw value). */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of a raw secret against a stored hash. */
export function verifySecret(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(raw), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function expiry(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}
