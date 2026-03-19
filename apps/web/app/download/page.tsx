'use client';

import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, Download as DownloadIcon, Laptop, MonitorCog, Shield } from 'lucide-react';
import Link from 'next/link';
import { getDesktopDownloads, type DesktopDownloadInfo } from '../../lib/auth';
import { Badge, Button, Card, Banner } from '../../components/ui';

export default function Download() {
  const [downloads, setDownloads] = useState<DesktopDownloadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const result = await getDesktopDownloads();
        if (!active) {
          return;
        }

        setDownloads(result);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load downloads');
        }
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

  return (
    <main className="page--narrow">
      <Link href="/" className="button button--ghost" style={{ width: 'fit-content' }}>
        <ArrowLeft size={16} />
        Back to Home
      </Link>

      <section className="hero" style={{ marginTop: 24 }}>
        <Badge>Desktop acquisition</Badge>
        <h1 className="section-heading" style={{ fontSize: 'clamp(2rem, 5vw, 3.6rem)' }}>
          Download GORKH
        </h1>
        <p className="hero__subtitle" style={{ maxWidth: 640 }}>
          Install the signed desktop app to start with the free local assistant on your own machine. Paid
          billing stays optional and unlocks premium features after sign-in.
        </p>
      </section>

      {loading ? (
        <div className="banner" style={{ marginTop: 28 }}>
          <Activity size={16} className="spinner" />
          Loading current desktop release...
        </div>
      ) : error ? (
        <div style={{ marginTop: 28 }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : downloads ? (
        <>
          <Card style={{ marginTop: 28 }}>
            <div className="split">
              <div className="stack" style={{ gap: 12 }}>
                <p className="section-title" style={{ marginBottom: 0 }}>
                  Current desktop version
                </p>
                <h2 className="section-heading" style={{ fontSize: 32 }}>
                  v{downloads.version}
                </h2>
                {downloads.notes ? <p className="copy">{downloads.notes}</p> : null}
              </div>
              <div className="stack" style={{ gap: 10, minWidth: 180 }}>
                <Badge>
                  <Shield size={14} />
                  Signed release
                </Badge>
                {downloads.publishedAt ? (
                  <p className="small-note mono">Published {new Date(downloads.publishedAt).toLocaleString()}</p>
                ) : null}
              </div>
            </div>
          </Card>

          <section className="downloads-grid" style={{ marginTop: 24 }}>
            <Card hover>
              <MonitorCog size={22} />
              <h2 className="section-heading" style={{ fontSize: 22, marginTop: 18 }}>
                Windows
              </h2>
              <p className="copy" style={{ marginTop: 10 }}>
                Windows 10 and 11 64-bit desktop operator build.
              </p>
              <a href={downloads.windowsUrl} style={{ marginTop: 20 }}>
                <Button className="button--wide">
                  <DownloadIcon size={16} />
                  Download for Windows
                </Button>
              </a>
            </Card>

            <Card hover>
              <Laptop size={22} />
              <h2 className="section-heading" style={{ fontSize: 22, marginTop: 18 }}>
                macOS Apple Silicon
              </h2>
              <p className="copy" style={{ marginTop: 10 }}>
                Signed desktop app for M-series Macs.
              </p>
              <a href={downloads.macArmUrl} style={{ marginTop: 20 }}>
                <Button className="button--wide" variant="secondary">
                  <DownloadIcon size={16} />
                  Download for macOS (Apple Silicon)
                </Button>
              </a>
            </Card>

            <Card hover>
              <Laptop size={22} />
              <h2 className="section-heading" style={{ fontSize: 22, marginTop: 18 }}>
                macOS Intel
              </h2>
              <p className="copy" style={{ marginTop: 10 }}>
                Signed desktop app for Intel-based Macs.
              </p>
              <a href={downloads.macIntelUrl} style={{ marginTop: 20 }}>
                <Button className="button--wide" variant="secondary">
                  <DownloadIcon size={16} />
                  Download for macOS (Intel)
                </Button>
              </a>
            </Card>
          </section>
        </>
      ) : null}
    </main>
  );
}
