'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-react';
import { completeDesktopAuth, getMe } from '../../../lib/auth';
import { Card } from '../../../components/ui';

function DesktopSignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const attemptId = searchParams.get('attemptId');
  const [message, setMessage] = useState('Checking browser session...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      if (!attemptId) {
        if (!active) {
          return;
        }
        setError('Missing desktop auth attempt id.');
        setMessage('Desktop sign-in could not start.');
        return;
      }

      try {
        const user = await getMe();
        if (!user) {
          router.replace(`/login?${new URLSearchParams({
            next: `/desktop/sign-in?attemptId=${attemptId}`,
          }).toString()}`);
          return;
        }

        if (!active) {
          return;
        }

        setMessage(`Signed in as ${user.email}. Completing desktop sign-in...`);

        const completion = await completeDesktopAuth(attemptId);
        const redirectUrl = new URL(completion.callbackUrl);
        redirectUrl.searchParams.set('handoffToken', completion.handoffToken);
        redirectUrl.searchParams.set('state', completion.state);
        window.location.replace(redirectUrl.toString());
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Desktop sign-in failed');
        setMessage('Desktop sign-in failed.');
      }
    })();

    return () => {
      active = false;
    };
  }, [attemptId, router]);

  return (
    <main className="page page--center">
      <Card className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{ margin: '0 auto 18px', width: 74, height: 74, borderRadius: '50%', display: 'grid', placeItems: 'center', border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}>
          {error ? (
            <XCircle size={28} color="#f87171" />
          ) : message.includes('Completing') ? (
            <Loader2 size={28} className="spinner" />
          ) : message.includes('Signed in as') ? (
            <Loader2 size={28} className="spinner" />
          ) : message.includes('failed') ? (
            <XCircle size={28} color="#f87171" />
          ) : message.includes('could not start') ? (
            <XCircle size={28} color="#f87171" />
          ) : (
            <Terminal size={28} />
          )}
        </div>
        <h1 className="section-heading" style={{ fontSize: 28 }}>
          Desktop Sign In
        </h1>
        <p className="copy" style={{ marginTop: 12 }}>
          {message}
        </p>
        {!error && message.includes('Completing') ? (
          <p className="small-note mono" style={{ marginTop: 12 }}>
            Handoff in progress...
          </p>
        ) : null}
        {error ? (
          <p className="small-note" style={{ marginTop: 16, color: '#fecaca' }}>
            {error}
          </p>
        ) : null}
      </Card>
    </main>
  );
}

export default function DesktopSignInPage() {
  return (
    <Suspense
      fallback={
        <main className="page page--center">
          <Card className="auth-card" style={{ textAlign: 'center' }}>
            <CheckCircle2 size={24} style={{ margin: '0 auto 18px', opacity: 0.5 }} />
            <h1 className="section-heading" style={{ fontSize: 28 }}>
              Desktop Sign In
            </h1>
            <p className="copy" style={{ marginTop: 12 }}>
              Loading desktop sign-in...
            </p>
          </Card>
        </main>
      }
    >
      <DesktopSignInPageContent />
    </Suspense>
  );
}
