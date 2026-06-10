"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertCircle, Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import Logo from '@/components/Logo';
import SocialAuthButtons from '@/components/SocialAuthButtons';

const RESEND_SECONDS = 60;

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'details' | 'otp'>('details');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Countdown for the "Resend code" button.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const startSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/signup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username: username || undefined, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send verification code');

      setStep('otp');
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/signup/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      // Same as login: drop queries cached while logged out (the 401'd /me never
      // refetches by itself), so entitlement & data load fresh after the redirect.
      queryClient.clear();
      router.refresh();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const resendCode = async () => {
    if (resendIn > 0 || isLoading) return;
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/signup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username: username || undefined, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resend code');
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">
            <Logo size={32} /> OtakuMind
          </h1>
          <p className="auth-subtitle">
            {step === 'details'
              ? 'Create your personal anime tracker account.'
              : `Enter the 6-digit code sent to ${email}.`}
          </p>
        </div>

        {step === 'details' ? (
          <>
          <form onSubmit={startSignup} className="auth-form">
            {error && (
              <div className="auth-error">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className="auth-field">
              <label className="auth-label" htmlFor="name">
                YOUR NAME
              </label>
              <input
                id="name"
                type="text"
                className="auth-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name"
                required
                disabled={isLoading}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="username">
                USERNAME (OPTIONAL)
              </label>
              <input
                id="username"
                type="text"
                className="auth-input"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="your_handle (auto-generated if blank)"
                maxLength={20}
                disabled={isLoading}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="email">
                EMAIL ADDRESS
              </label>
              <input
                id="email"
                type="email"
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={isLoading}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="password">
                PASSWORD (MIN 6 CHARS)
              </label>
              <div className="auth-input-wrapper">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input auth-input-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="auth-button" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Sending code...
                </>
              ) : (
                'Continue'
              )}
            </button>
          </form>

          <SocialAuthButtons mode="signup" disabled={isLoading} onError={setError} />
          </>
        ) : (
          <form onSubmit={verifyOtp} className="auth-form">
            {error && (
              <div className="auth-error">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className="auth-field">
              <label className="auth-label" htmlFor="code">
                VERIFICATION CODE
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="auth-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                required
                disabled={isLoading}
                autoFocus
              />
            </div>

            <button type="submit" className="auth-button" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Verifying...
                </>
              ) : (
                'Verify & Create Account'
              )}
            </button>

            <button
              type="button"
              className="auth-forgot-back-link"
              onClick={resendCode}
              disabled={resendIn > 0 || isLoading}
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
            </button>

            <button
              type="button"
              className="auth-forgot-back-link"
              onClick={() => {
                setStep('details');
                setCode('');
                setError(null);
              }}
            >
              <ArrowLeft size={16} /> Edit details
            </button>
          </form>
        )}

        <div className="auth-footer">
          Already have an account?
          <Link href="/login" className="auth-footer-link">
            Sign In
          </Link>
        </div>
        <p className="auth-legal">
          <Link href="/privacy" className="auth-legal-link">
            Privacy Policy
          </Link>
        </p>
        <p className="auth-credit">
          Designed &amp; developed by{' '}
          <a
            href="https://thekhushikumari.com"
            target="_blank"
            rel="noopener noreferrer"
            className="auth-credit-link"
          >
            Khushi Kumari
          </a>
        </p>
      </div>
    </div>
  );
}
