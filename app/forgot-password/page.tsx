"use client";

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Logo from '@/components/Logo';
import { errorMessage } from '@/lib/api-error';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Simulate sending password reset email
      await new Promise((resolve) => setTimeout(resolve, 1200));
      
      if (!email.includes('@')) {
        throw new Error('Please enter a valid email address.');
      }
      
      setIsSubmitted(true);
    } catch (err: unknown) {
      setError(errorMessage(err, 'An error occurred. Please try again.'));
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
          <p className="auth-subtitle">Reset your account password.</p>
        </div>

        {isSubmitted ? (
          <div className="auth-success-state">
            <div className="success-icon-wrapper">
              <CheckCircle2 size={48} className="success-icon" />
            </div>
            <h3 className="success-title">Reset Link Sent!</h3>
            <p className="success-description">
              We&apos;ve sent a recovery email to <strong>{email}</strong>.
              Please check your inbox and follow the instructions to restore your account.
            </p>
            <Link href="/login" className="auth-button auth-back-button">
              <ArrowLeft size={16} /> Back to Sign In
            </Link>
          </div>
        ) : (
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

            <button type="submit" className="auth-button" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Sending recovery link...
                </>
              ) : (
                'Send Recovery Link'
              )}
            </button>

            <Link href="/login" className="auth-forgot-back-link">
              <ArrowLeft size={16} /> Back to Sign In
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
