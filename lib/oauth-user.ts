// Find-or-create a user for a verified social sign-in (Apple / Google).
//
// Matching is by email (both providers include a stable `email` claim in the
// identity token on every sign-in). OAuth accounts have no usable password, so we
// store a random hash to satisfy the non-null `password` column — password login
// for these accounts will always fail, which is intended.

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { findAvailableUsername, slugifyUsername } from '@/lib/username';

export interface OAuthProfile {
  email: string;
  name?: string | null;
}

/** 32 random bytes as hex, via the Web Crypto global (no Node import needed). */
function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function upsertOAuthUser({ email, name }: OAuthProfile) {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) return existing;

  const isTaken = async (candidate: string) =>
    (await db.user.count({ where: { username: candidate } })) > 0;
  const base = name
    ? slugifyUsername(name)
    : slugifyUsername(normalizedEmail.split('@')[0]);
  const username = await findAvailableUsername(base, isTaken);

  // Unusable random password — these accounts authenticate via the provider only.
  const password = hashPassword(randomSeed());

  return db.user.create({
    data: { email: normalizedEmail, username, password, name: name || null },
  });
}
