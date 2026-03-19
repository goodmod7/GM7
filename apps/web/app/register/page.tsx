'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeySquare, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '../../lib/auth';
import { Banner, Button, Card, FieldLabel, TextInput } from '../../components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      router.push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page page--center">
      <Card className="auth-card">
        <div className="hero" style={{ gap: 16, textAlign: 'center' }}>
          <div className="eyebrow" style={{ justifyContent: 'center' }}>
            <KeySquare size={14} />
            Operator initialization
          </div>
          <div>
            <UserPlus size={24} style={{ margin: '0 auto 16px', color: 'rgba(255,255,255,0.55)' }} />
            <h1 className="section-heading" style={{ fontSize: 30 }}>
              Register
            </h1>
            <p className="copy" style={{ marginTop: 10 }}>
              Create an operator identity for dashboard access, billing, downloads, and desktop sign-in relay.
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
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 8 chars)"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" loading={loading} className="button--wide">
            <ArrowRight size={16} />
            {loading ? 'Creating account...' : 'Register'}
          </Button>
        </form>

        <p className="small-note" style={{ marginTop: 18, textAlign: 'center' }}>
          Already registered?{' '}
          <Link href="/login" style={{ color: 'var(--text)' }}>
            Login
          </Link>
        </p>
      </Card>
    </main>
  );
}
