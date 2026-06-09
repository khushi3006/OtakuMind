"use client";

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import Logo from '@/components/Logo';
import { errorMessage } from '@/lib/api-error';

function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Success! Drop every cached query — /api/auth/me 401'd while logged out and 4xx
      // errors never refetch on their own, which would leave the entitlement (and any
      // previous user's data) stale after this client-side navigation.
      queryClient.clear();
      router.refresh();
      router.push(redirectPath);
    } catch (err: unknown) {
      setError(errorMessage(err, 'An error occurred. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-header">
        <h1 className="auth-title">
          <Logo size={32} /> OtakuMind
        </h1>
        <p className="auth-subtitle">Welcome back. Please log in to your account.</p>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        {error && (
          <div className="auth-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

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
            PASSWORD
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

        <div className="auth-form-helpers">
          <label className="auth-remember-me">
            <input
              type="checkbox"
              className="auth-checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={isLoading}
            />
            <span className="checkbox-custom"></span>
            <span className="auth-remember-me-text">Remember me</span>
          </label>
          <Link href="/forgot-password" className="auth-forgot-link">
            Forgot Password?
          </Link>
        </div>

        <button type="submit" className="auth-button" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 size={18} className="spin" />
              Logging in...
            </>
          ) : (
            'Sign In'
          )}
        </button>
      </form>

      <div className="auth-footer">
        Don&apos;t have an account?
        <Link href="/signup" className="auth-footer-link">
          Create account
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
  );
}

export default function LoginPage() {
  return (
    <div className="auth-wrapper">
      <Suspense fallback={
        <div className="auth-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          <Loader2 size={36} className="spin" style={{ color: 'var(--accent-color)', marginBottom: '1rem' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Loading OtakuMind Auth...</p>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  );
}
