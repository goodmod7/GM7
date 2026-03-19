'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, CreditCard, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { createCheckoutSession, createPortalSession, getBillingStatus, type BillingStatus } from '../../lib/auth';
import { Banner, Badge, Button, Card } from '../../components/ui';

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
      <main className="page--narrow">
        <div className="banner">
          <Sparkles size={16} className="spinner" />
          Loading billing status...
        </div>
      </main>
    );
  }

  return (
    <main className="page--narrow">
      <div className="split">
        <Link href="/" className="button button--ghost" style={{ width: 'fit-content' }}>
          <ArrowLeft size={16} />
          Back to Home
        </Link>
        <Link href="/dashboard" className="button button--secondary" style={{ width: 'fit-content' }}>
          Dashboard
        </Link>
      </div>

      <section className="hero" style={{ marginTop: 28 }}>
        <Badge>
          <CreditCard size={14} />
          Billing
        </Badge>
        <h1 className="section-heading" style={{ fontSize: 'clamp(2rem, 4vw, 3.2rem)' }}>
          Billing and Quotas
        </h1>
        <p className="hero__subtitle" style={{ maxWidth: 680 }}>
          Manage your subscription to unlock run creation and remote control automation while keeping the free
          local path intact.
        </p>
      </section>

      <div className="stack" style={{ marginTop: 24 }}>
        {billingState === 'success' ? (
          <Banner tone="success">Billing completed. Your subscription status will update as soon as the Stripe webhook is processed.</Banner>
        ) : null}

        {billingState === 'cancel' ? (
          <Banner tone="warning">Checkout was canceled. You can resume anytime.</Banner>
        ) : null}

        {error ? <Banner tone="danger">{error}</Banner> : null}
      </div>

      <Card style={{ marginTop: 24 }}>
        <div className="split">
          <div className="stack" style={{ gap: 12 }}>
            <p className="section-title" style={{ marginBottom: 0 }}>
              Subscription status
            </p>
            <h2 className="section-heading" style={{ fontSize: 36 }}>
              {isActive ? 'Active' : 'Inactive'}
            </h2>
            <p className="copy">
              {isActive
                ? 'Premium remote-control and run creation features are unlocked for this account.'
                : 'Upgrade only if you need premium remote workflows. Local desktop acquisition remains available without it.'}
            </p>
          </div>

          <div className="stack" style={{ gap: 10, minWidth: 220 }}>
            <Badge tone={isActive ? 'success' : 'warning'}>
              <ShieldCheck size={14} />
              {isActive ? 'Pro Network Active' : 'Upgrade Available'}
            </Badge>
            {billing?.subscriptionCurrentPeriodEnd ? (
              <p className="small-note mono">
                Current period ends: {new Date(billing.subscriptionCurrentPeriodEnd).toLocaleString()}
              </p>
            ) : null}
            {billing?.planPriceId ? <p className="small-note mono">Price: {billing.planPriceId}</p> : null}
          </div>
        </div>

        <div className="row-actions" style={{ marginTop: 24 }}>
          {isActive ? (
            <Button
              onClick={() => {
                void handleManageBilling();
              }}
              loading={busy}
              variant="secondary"
            >
              Manage Billing
            </Button>
          ) : (
            <Button
              onClick={() => {
                void handleSubscribe();
              }}
              loading={busy}
            >
              Upgrade to Pro
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
