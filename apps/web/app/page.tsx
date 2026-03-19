import { Activity, ArrowRight, Download, HardDrive, Shield, Terminal } from 'lucide-react';
import Link from 'next/link';
import { GorkhLogo } from '../components/brand';
import { Card } from '../components/ui';

export default function Home() {
  return (
    <main className="page">
      <section className="hero hero--center">
        <div className="eyebrow">
          <Activity size={14} />
          System v2.14.0 deployed
        </div>

        <div style={{ display: 'grid', gap: 20, justifyItems: 'center' }}>
          <GorkhLogo />
          <p
            className="mono"
            style={{
              margin: 0,
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              fontSize: 12,
            }}
          >
            Desktop Intelligence Layer
          </p>
        </div>

        <h1 className="hero__title">GORKH</h1>
        <p className="hero__subtitle">
          The desktop-first assistant that runs directly on your hardware. Local-first speed, deliberate
          approvals, and optional cloud surfaces for account, downloads, and remote management.
        </p>

        <div className="hero__actions">
          <Link href="/download">
            <span className="button">
              <Download size={16} />
              Download Desktop App
            </span>
          </Link>
          <Link href="/dashboard">
            <span className="button button--secondary">
              <Terminal size={16} />
              Open Dashboard
            </span>
          </Link>
          <Link href="/login">
            <span className="button button--ghost">
              Login
              <ArrowRight size={16} />
            </span>
          </Link>
        </div>
      </section>

      <section className="grid grid--3" style={{ marginTop: 56 }}>
        <Card hover>
          <HardDrive size={20} />
          <h2 className="section-heading" style={{ fontSize: 20, marginTop: 18 }}>
            Local Priority
          </h2>
          <p className="copy" style={{ marginTop: 12 }}>
            Your data stays on your machine. Desktop approvals, local tooling, and filesystem context stay
            close to the work.
          </p>
        </Card>
        <Card hover>
          <Terminal size={20} />
          <h2 className="section-heading" style={{ fontSize: 20, marginTop: 18 }}>
            Remote Surfaces
          </h2>
          <p className="copy" style={{ marginTop: 12 }}>
            The website manages account access, downloads, billing, and older desktop support without taking
            the desktop-first product off center.
          </p>
        </Card>
        <Card hover>
          <Shield size={20} />
          <h2 className="section-heading" style={{ fontSize: 20, marginTop: 18 }}>
            Controlled Access
          </h2>
          <p className="copy" style={{ marginTop: 12 }}>
            Pairing, auth, and desktop handoff flows stay explicit. The web surface complements the machine,
            rather than pretending to replace it.
          </p>
        </Card>
      </section>
    </main>
  );
}
