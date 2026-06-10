// Client hook shared by the social sign-in buttons (Google / Apple): POSTs the
// provider token to the given auth route, then finishes exactly like password
// login (clear cached queries, refresh, redirect).

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/lib/api-error';

interface Options {
  endpoint: '/api/auth/google' | '/api/auth/apple';
  fallbackError: string;
  /** Where to navigate after a successful sign-in. */
  redirectPath: string;
  /** Surfaces errors in the page's existing error box (null clears it). */
  onError: (message: string | null) => void;
}

export function useSocialSignIn({ endpoint, fallbackError, redirectPath, onError }: Options) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const postingRef = useRef(false);
  const [isPosting, setIsPosting] = useState(false);

  const submit = useCallback(
    async (body: Record<string, unknown>) => {
      if (postingRef.current) return;
      postingRef.current = true;
      setIsPosting(true);
      onError(null);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sign-in failed');

        // Same as password login: drop queries cached while logged out (the 401'd
        // /api/auth/me never refetches on its own) so data loads fresh post-redirect.
        queryClient.clear();
        router.refresh();
        router.push(redirectPath);
      } catch (err) {
        onError(errorMessage(err, fallbackError));
        postingRef.current = false;
        setIsPosting(false);
      }
    },
    [endpoint, fallbackError, onError, queryClient, redirectPath, router],
  );

  return { submit, isPosting };
}
