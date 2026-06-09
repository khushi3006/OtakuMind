'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

  const headline = forced ? 'Your free trial has ended' : 'OtakuMind Lifetime';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="OtakuMind Lifetime" dismissable={!forced}>
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
      </div>
    </Modal>
  );
}
