"use client";

/**
 * Apple half of the web social sign-in (rendered by SocialAuthButtons). Uses
 * Sign in with Apple JS in popup mode: AppleID.auth.signIn() returns an
 * identityToken that is POSTed to the same /api/auth/apple route the iOS app
 * uses. The token's audience is the web Services ID
 * (NEXT_PUBLIC_APPLE_CLIENT_ID), which must be one of the APPLE_CLIENT_ID
 * audiences the route verifies against. Apple only accepts the HTTPS return
 * URLs registered on the Services ID, so the popup works on the production
 * domain — not on localhost. Renders nothing when unset.
 */

import { useCallback, useRef } from 'react';
import Script from 'next/script';
import { Loader2 } from 'lucide-react';
import { useSocialSignIn } from '@/lib/use-social-signin';

const APPLE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || '';
const APPLE_JS_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

interface AppleSignInResponse {
  authorization: { code: string; id_token: string; state?: string };
  /** Only present on the very first authorization for this Apple ID. */
  user?: { email?: string; name?: { firstName?: string; lastName?: string } };
}

interface AppleIDAuth {
  init: (config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    usePopup: boolean;
  }) => void;
  signIn: () => Promise<AppleSignInResponse>;
}

declare global {
  interface Window {
    AppleID?: { auth?: AppleIDAuth };
  }
}

/** signIn() rejects with plain objects like { error: 'popup_closed_by_user' }. */
const CANCEL_CODES = new Set(['popup_closed_by_user', 'user_cancelled_authorize']);

interface Props {
  mode: 'login' | 'signup';
  /** Where to navigate after a successful sign-in. */
  redirectPath?: string;
  /** Dim and ignore clicks while the surrounding form is submitting. */
  disabled?: boolean;
  /** Surfaces errors in the page's existing error box (null clears it). */
  onError: (message: string | null) => void;
}

export default function AppleSignInButton({
  mode,
  redirectPath = '/',
  disabled,
  onError,
}: Props) {
  const initializedRef = useRef(false);
  const { submit, isPosting } = useSocialSignIn({
    endpoint: '/api/auth/apple',
    fallbackError: "Couldn't sign in with Apple. Please try again.",
    redirectPath,
    onError,
  });

  // Lazy, once-per-mount init: called from Script onReady (covers first load and
  // remounts, e.g. navigating login -> signup) and again defensively at click time.
  const ensureInit = useCallback(() => {
    const auth = window.AppleID?.auth;
    if (!auth) return null;
    if (!initializedRef.current) {
      auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: 'name email',
        // Must exactly match a Return URL registered on the Services ID
        // (https://<domain>/login and /signup are registered).
        redirectURI: `${window.location.origin}${window.location.pathname}`,
        usePopup: true,
      });
      initializedRef.current = true;
    }
    return auth;
  }, []);

  const handleClick = async () => {
    if (isPosting) return;
    const auth = ensureInit();
    if (!auth) {
      onError('Apple sign-in is still loading. Please try again in a moment.');
      return;
    }
    onError(null);

    let response: AppleSignInResponse;
    try {
      response = await auth.signIn();
    } catch (err) {
      const code = (err as { error?: string } | null)?.error;
      if (code && CANCEL_CODES.has(code)) return; // silent, like the mobile buttons
      onError("Couldn't sign in with Apple. Please try again.");
      return;
    }

    const idToken = response?.authorization?.id_token;
    if (!idToken) {
      onError('No identity token returned from Apple.');
      return;
    }

    // Apple sends name/email only on the first authorization; on later sign-ins
    // the route falls back to the verified token's email claim.
    void submit({
      identityToken: idToken,
      email: response.user?.email,
      fullName: response.user?.name
        ? {
            givenName: response.user.name.firstName,
            familyName: response.user.name.lastName,
          }
        : undefined,
    });
  };

  if (!APPLE_CLIENT_ID) return null;

  return (
    <div className={disabled || isPosting ? 'auth-social-busy' : undefined}>
      <Script
        src={APPLE_JS_SRC}
        onReady={() => {
          ensureInit();
        }}
        onError={() =>
          onError("Couldn't load Apple sign-in. Check your connection and try again.")
        }
      />
      {isPosting ? (
        <div className="auth-social-pending">
          <Loader2 size={18} className="spin" />
          {mode === 'login' ? 'Signing in with Apple...' : 'Signing up with Apple...'}
        </div>
      ) : (
        <button
          type="button"
          className="apple-signin-btn"
          onClick={handleClick}
          disabled={disabled}
        >
          <svg viewBox="0 0 814 1000" width="16" height="16" aria-hidden="true" fill="currentColor">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
          </svg>
          {mode === 'login' ? 'Continue with Apple' : 'Sign up with Apple'}
        </button>
      )}
    </div>
  );
}
