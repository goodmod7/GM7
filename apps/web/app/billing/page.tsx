'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createCheckoutSession, createPortalSession, getBillingStatus, type BillingStatus } from '../../lib/auth';

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingState, setBillingState] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setBillingState(params.get('billing'));
    }

    void (async () => {
      try {
        const status = await getBillingStatus();
        if (!active) {
          return;
        }
        setBilling(status);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load billing status');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const isActive = billing?.subscriptionStatus === 'active';

  const handleSubscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await createCheckoutSession();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setBusy(false);
    }
  };

  const handleManageBilling = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await createPortalSession();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <p>Loading billing status...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: '#0070f3', textDecoration: 'none' }}>
          ← Back to Home
        </Link>
        <Link href="/dashboard" style={{ color: '#0070f3', textDecoration: 'none' }}>
          Dashboard →
        </Link>
      </div>

      <h1 style={{ marginTop: '1rem' }}>Billing</h1>
      <p>Manage your subscription to unlock run creation and remote control automation.</p>

      {billingState === 'success' && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', color: '#166534' }}>
          Billing completed. Your subscription status will update as soon as the Stripe webhook is processed.
        </div>
      )}

      {billingState === 'cancel' && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', color: '#92400e' }}>
          Checkout was canceled. You can resume anytime.
        </div>
      )}

      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b' }}>
          {error}
        </div>
      )}

      <section style={{ marginTop: '1.5rem', padding: '1rem', background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Subscription status</div>
        <div style={{ marginTop: '0.25rem', fontSize: '1.25rem', fontWeight: 600, color: isActive ? '#166534' : '#991b1b' }}>
          {isActive ? 'Active' : 'Inactive'}
        </div>
        {billing?.subscriptionCurrentPeriodEnd && (
          <p style={{ marginTop: '0.5rem', color: '#6b7280' }}>
            Current period ends: {new Date(billing.subscriptionCurrentPeriodEnd).toLocaleString()}
          </p>
        )}
        {billing?.planPriceId && (
          <p style={{ marginTop: '0.25rem', color: '#6b7280' }}>
            Price: {billing.planPriceId}
          </p>
        )}

        <div style={{ marginTop: '1rem' }}>
          {isActive ? (
            <button
              onClick={() => {
                void handleManageBilling();
              }}
              disabled={busy}
              style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                background: busy ? '#9ca3af' : '#0f766e',
                color: 'white',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              Manage Billing
            </button>
          ) : (
            <button
              onClick={() => {
                void handleSubscribe();
              }}
              disabled={busy}
              style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                background: busy ? '#9ca3af' : '#2563eb',
                color: 'white',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              Subscribe
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
