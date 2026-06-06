import { QueryClient } from '@tanstack/react-query';
import { ApiError, isWakingUpError } from '@/lib/api';

// Neon scale-to-zero cold starts can take ~15s; retry those patiently at a fixed
// 3s cadence (preserving the old pages' indefinite-ish "waking up" retry loop).
const WAKING_UP_MAX_RETRIES = 6;

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
          if (isWakingUpError(err)) return count < WAKING_UP_MAX_RETRIES;
          return count < 2;
        },
        retryDelay: (count, err) =>
          isWakingUpError(err) ? 3000 : Math.min(1000 * 2 ** count, 30_000),
      },
      mutations: { retry: false },
    },
  });
}
