const DEADLOCK_PATTERNS = [
  'deadlock detected',
  'code: `40p01`',
  'code: 40p01',
  'transaction not found',
  'closed transaction',
  'expired transaction',
];

function isDeadlockError(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false;
  }

  const message = String(error.message).toLowerCase();
  return DEADLOCK_PATTERNS.some((pattern) => message.includes(pattern));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDeadlockRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; delayMs?: number } = {}
) {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 120;

  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isDeadlockError(error) || attempt >= retries) {
        throw error;
      }

      attempt += 1;
      await sleep(delayMs * attempt);
    }
  }
}
