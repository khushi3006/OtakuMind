"use client";

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

      // Success! Refresh router and redirect
      router.refresh();
      router.push(redirectPath);
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-header">
        <h1 className="auth-title">
          <span className="logo-dot"></span> OtakuMind
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
          <input
            id="password"
            type="password"
            className="auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            disabled={isLoading}
          />
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
        Don't have an account?
        <Link href="/signup" className="auth-footer-link">
          Create account
        </Link>
      </div>
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
