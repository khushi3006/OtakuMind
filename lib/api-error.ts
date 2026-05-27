// Small typed helpers for narrowing unknown errors in API route catch blocks,
// avoiding `catch (e: any)` while still reaching Error.message / Prisma error codes.

export function errorMessage(error: unknown, fallback = 'Server error'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
