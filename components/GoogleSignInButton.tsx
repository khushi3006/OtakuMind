"use client";

/**
 * "Continue with Google" for the web auth pages — the browser counterpart of the
 * mobile app's SocialAuthButtons. Renders the official Google Identity Services
 * (GIS) button, which yields a Google ID token; that token is POSTed to the same
 * /api/auth/google route the iOS app uses. The token's audience is
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID, which must be one of the GOOGLE_CLIENT_ID
 * audiences the route verifies against (in practice: the same web client id).
 * Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset, like the mobile
 * buttons when unconfigured.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/api-error';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      logo_alignment?: 'left' | 'center';
      width?: number;
    },
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

interface Props {
  mode: 'login' | 'signup';
  /** Where to navigate after a successful sign-in. */
  redirectPath?: string;
  /** Dim and ignore clicks while the surrounding form is submitting. */
  disabled?: boolean;
  /** Surfaces errors in the page's existing error box (null clears it). */
  onError: (message: string | null) => void;
}

export default function GoogleSignInButton({
  mode,
  redirectPath = '/',
  disabled,
  onError,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const buttonRef = useRef<HTMLDivElement>(null);
  const postingRef = useRef(false);
  const [isPosting, setIsPosting] = useState(false);

  const handleCredential = useCallback(
    async (response: { credential?: string }) => {
      const idToken = response.credential;
      if (!idToken || postingRef.current) return;
      postingRef.current = true;
      setIsPosting(true);
      onError(null);

      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Google sign-in failed');

        // Same as password login: drop queries cached while logged out (the 401'd
        // /api/auth/me never refetches on its own) so data loads fresh post-redirect.
        queryClient.clear();
        router.refresh();
        router.push(redirectPath);
      } catch (err) {
        onError(errorMessage(err, "Couldn't sign in with Google. Please try again."));
        postingRef.current = false;
        setIsPosting(false);
      }
    },
    [onError, queryClient, redirectPath, router],
  );

  const renderButton = useCallback(() => {
    const gsi = window.google?.accounts?.id;
    const container = buttonRef.current;
    if (!gsi || !container) return;
    gsi.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
    container.replaceChildren(); // idempotent across remounts / strict-mode double effects
    gsi.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: mode === 'login' ? 'continue_with' : 'signup_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: Math.max(200, Math.min(400, container.offsetWidth || 320)),
    });
  }, [handleCredential, mode]);

  // The GIS script may already be loaded (e.g. navigating login -> signup);
  // Script onReady covers the first load and later remounts.
  useEffect(() => {
    renderButton();
  }, [renderButton]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className={`auth-social${disabled || isPosting ? ' auth-social-busy' : ''}`}>
      <Script
        src={GSI_SRC}
        onReady={renderButton}
        onError={() =>
          onError("Couldn't load Google sign-in. Check your connection and try again.")
        }
      />
      <div className="auth-social-divider">
        <span className="auth-social-line" />
        <span className="auth-social-text">
          {mode === 'login' ? 'or continue with' : 'or sign up with'}
        </span>
        <span className="auth-social-line" />
      </div>
      {isPosting && (
        <div className="auth-social-pending">
          <Loader2 size={18} className="spin" />
          {mode === 'login' ? 'Signing in with Google...' : 'Signing up with Google...'}
        </div>
      )}
      <div
        ref={buttonRef}
        className="auth-social-button"
        style={isPosting ? { display: 'none' } : undefined}
      />
    </div>
  );
}
