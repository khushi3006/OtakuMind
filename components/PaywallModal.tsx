'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';

// Minimal shape of the global injected by Razorpay's checkout.js.
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadCheckout(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = CHECKOUT_SRC;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Hard-gate mode: cannot be dismissed and shows the trial-ended copy. */
  forced?: boolean;
  trialEndsAt?: string | null;
}

export default function PaywallModal({ isOpen, onClose, forced = false, trialEndsAt }: PaywallModalProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Swap the gate's body into an inline delete-confirmation instead of stacking a
  // second modal — mirrors the mobile gate sheet and keeps the forced gate intact.
  const [mode, setMode] = useState<'paywall' | 'delete'>('paywall');
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onBuy = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await loadCheckout();
      if (!ok || !window.Razorpay) throw new Error('Could not load checkout');

      const orderRes = await fetch('/api/billing/razorpay/order', { method: 'POST' });
      if (!orderRes.ok) throw new Error('Could not start checkout');
      const { orderId, amount, currency, keyId } = await orderRes.json();

      const rzp = new window.Razorpay({
        key: keyId,
        order_id: orderId,
        amount,
        currency,
        name: 'OtakuMind',
        description: 'Lifetime access',
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const verifyRes = await fetch('/api/billing/razorpay/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(resp),
          });
          if (verifyRes.ok) {
            // Refetch everything (not just `me`): while expired, the data queries cached 403s,
            // so they must reload now that the user is entitled — otherwise the page looks empty
            // until a manual refresh.
            await queryClient.invalidateQueries();
            onClose();
          } else {
            setError('Payment could not be verified. If you were charged, it will unlock shortly.');
          }
          setBusy(false);
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch {
      setError('Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore — navigate to login regardless
    }
    window.location.href = '/login';
  };

  const closeDelete = () => {
    if (deleting) return;
    setMode('paywall');
    setConfirmText('');
    setDeleteError(null);
  };

  const onDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    // Belt-and-suspenders: the button is disabled until this matches, but guard here
    // too so the destructive request can never fire without an explicit confirmation.
    if (confirmText !== 'DELETE') return;

    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error || 'Failed to delete account');
        setDeleting(false);
        return;
      }
      // Account gone and cookie cleared server-side — leave to login, same as sign-out.
      window.location.href = '/login';
    } catch {
      setDeleteError('An unexpected error occurred');
      setDeleting(false);
    }
  };

  const headline = forced ? 'Your free trial has ended' : 'OtakuMind Lifetime';

  const ghostLinkStyle = {
    background: 'none',
    border: 'none',
    color: 'inherit',
    opacity: 0.6,
    cursor: 'pointer',
    padding: 8,
    fontSize: 14,
  } as const;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'delete' ? 'Delete Account' : 'OtakuMind Lifetime'}
      dismissable={!forced}>
      {mode === 'delete' ? (
        <form onSubmit={onDelete} className="delete-account-form">
          {deleteError && <div className="feedback-msg error">{deleteError}</div>}

          <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            This permanently deletes your profile, anime list, and follows. This action cannot be
            undone.
          </p>

          <div className="form-group">
            <label htmlFor="paywallDeleteConfirm">
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              type="text"
              id="paywallDeleteConfirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={deleting}
            />
          </div>

          <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              className="modal-btn secondary"
              onClick={closeDelete}
              disabled={deleting}
              style={{ flex: 1 }}>
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn danger"
              disabled={deleting || confirmText !== 'DELETE'}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              {deleting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Deleting…</span>
                </>
              ) : (
                <span>Delete Account</span>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4 style={{ margin: 0 }}>{headline}</h4>
          <p style={{ margin: 0, opacity: 0.8 }}>
            Track unlimited anime, airing countdowns, your social graph, and Excel export — one-time
            payment of ₹299, yours forever.
          </p>
          {!forced && trialEndsAt ? (
            <p style={{ margin: 0, opacity: 0.6 }}>
              Trial ends {new Date(trialEndsAt).toLocaleDateString()}.
            </p>
          ) : null}
          {error ? <p style={{ margin: 0, color: 'crimson' }}>{error}</p> : null}
          <button className="auth-button" disabled={busy} onClick={onBuy}>
            {busy ? 'Processing…' : 'Unlock Lifetime — ₹299'}
          </button>
          {forced ? (
            // Escape hatch so a non-paying user isn't trapped behind the non-dismissable gate.
            <>
              <button type="button" onClick={onSignOut} disabled={busy} style={ghostLinkStyle}>
                Sign Out
              </button>
              <button
                type="button"
                onClick={() => setMode('delete')}
                disabled={busy}
                style={ghostLinkStyle}>
                Delete Account
              </button>
            </>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
