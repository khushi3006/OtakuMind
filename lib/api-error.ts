// Small typed helpers for narrowing unknown errors in API route catch blocks,
// avoiding `catch (e: any)` while still reaching Error.message / Prisma error codes.

export function errorMessage(error: unknown, fallback = 'Server error'): string {
  const real = error instanceof Error && error.message ? error.message : fallback;
  // In production, never return raw Error/Prisma messages to clients — they leak schema, table, and
  // column names useful for reconnaissance. Log the real cause server-side and return the generic
  // fallback. In development, surface the real message for debugging.
  if (process.env.NODE_ENV === 'production') {
    if (error) console.error('[api-error]', error);
    return fallback;
  }
  return real;
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
