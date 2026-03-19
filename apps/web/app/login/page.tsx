'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { login } from '../../lib/auth';
import { Banner, Button, Card, FieldLabel, TextInput } from '../../components/ui';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await login(email, password);
      const next = searchParams.get('next');
      router.push(next && next.startsWith('/') ? next : '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page page--center">
      <Card className="auth-card">
        <div className="hero" style={{ gap: 16, textAlign: 'center' }}>
          <div className="eyebrow" style={{ justifyContent: 'center' }}>
            <ShieldCheck size={14} />
            Browser auth relay
          </div>
          <div>
            <KeyRound size={24} style={{ margin: '0 auto 16px', color: 'rgba(255,255,255,0.55)' }} />
            <h1 className="section-heading" style={{ fontSize: 30 }}>
              Authenticate
            </h1>
            <p className="copy" style={{ marginTop: 10 }}>
              Access command center and resume any pending desktop sign-in flow.
            </p>
          </div>
        </div>

        {error ? (
          <div style={{ marginTop: 20 }}>
            <Banner tone="danger">{error}</Banner>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="stack" style={{ marginTop: 26 }}>
          <div>
            <FieldLabel>Operator Email</FieldLabel>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
          </div>
          <div>
            <FieldLabel>Passphrase</FieldLabel>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
          </div>
          <Button type="submit" loading={loading} className="button--wide">
            <LogIn size={16} />
            {loading ? 'Signing in...' : 'Login'}
          </Button>
        </form>

        <p className="small-note" style={{ marginTop: 18, textAlign: 'center' }}>
          Need an account?{' '}
          <Link href="/register" style={{ color: 'var(--text)' }}>
            Register
          </Link>
        </p>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="page page--center">
          <Card className="auth-card">
            <h1 className="section-heading" style={{ fontSize: 30 }}>
              Login
            </h1>
            <p className="copy" style={{ marginTop: 12 }}>
              Loading sign-in...
            </p>
          </Card>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
