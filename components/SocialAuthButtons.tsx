"use client";

/**
 * Divider + Apple + Google sign-in for the web auth pages — the browser
 * counterpart of the mobile app's SocialAuthButtons. Renders nothing if
 * neither provider is configured. Each button POSTs its provider token to the
 * same API route the iOS app uses (/api/auth/apple, /api/auth/google).
 */

import AppleSignInButton from '@/components/AppleSignInButton';
import GoogleSignInButton from '@/components/GoogleSignInButton';

const hasApple = Boolean(process.env.NEXT_PUBLIC_APPLE_CLIENT_ID);
const hasGoogle = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

interface Props {
  mode: 'login' | 'signup';
  /** Where to navigate after a successful sign-in. */
  redirectPath?: string;
  /** Dim and ignore clicks while the surrounding form is submitting. */
  disabled?: boolean;
  /** Surfaces errors in the page's existing error box (null clears it). */
  onError: (message: string | null) => void;
}

export default function SocialAuthButtons({
  mode,
  redirectPath = '/',
  disabled,
  onError,
}: Props) {
  if (!hasApple && !hasGoogle) return null;

  return (
    <div className="auth-social">
      <div className="auth-social-divider">
        <span className="auth-social-line" />
        <span className="auth-social-text">
          {mode === 'login' ? 'or continue with' : 'or sign up with'}
        </span>
        <span className="auth-social-line" />
      </div>
      <div className="auth-social-buttons">
        {hasApple && (
          <AppleSignInButton
            mode={mode}
            redirectPath={redirectPath}
            disabled={disabled}
            onError={onError}
          />
        )}
        {hasGoogle && (
          <GoogleSignInButton
            mode={mode}
            redirectPath={redirectPath}
            disabled={disabled}
            onError={onError}
          />
        )}
      </div>
    </div>
  );
}
