// Username helpers for the social layer.
// Usernames are public handles: lowercase, 3-20 chars, [a-z0-9_].

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

/**
 * Convert an arbitrary string (email local-part, display name, raw input) into a
 * candidate username: lowercased, non-alphanumeric collapsed to underscores,
 * trimmed to the max length. Returns "user" if nothing usable remains.
 */
export function slugifyUsername(input: string): string {
  const slug = (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, USERNAME_MAX);
  return slug.length >= USERNAME_MIN ? slug : (slug ? slug.padEnd(USERNAME_MIN, '0') : 'user');
}

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/**
 * Given a desired base and an async predicate that reports whether a candidate is
 * already taken, return the first free username (base, then base1, base2, ...).
 */
export async function findAvailableUsername(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = slugifyUsername(base);
  if (!(await isTaken(root))) return root;

  for (let i = 1; i < 10000; i++) {
    const suffix = String(i);
    const candidate = `${root.slice(0, USERNAME_MAX - suffix.length)}${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely fallback.
  return `${root.slice(0, USERNAME_MAX - 6)}${Date.now().toString().slice(-5)}`;
}
