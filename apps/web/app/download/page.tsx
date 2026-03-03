'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDesktopDownloads, type DesktopDownloadInfo } from '../../lib/auth';

export default function Download() {
  const [downloads, setDownloads] = useState<DesktopDownloadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [requiresSubscription, setRequiresSubscription] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const result = await getDesktopDownloads();
        if (!active) {
          return;
        }

        if (!result) {
          setRequiresSubscription(true);
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
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#0070f3', textDecoration: 'none' }}>
        ← Back to Home
      </Link>

      <h1 style={{ marginTop: '1rem' }}>Download AI Operator</h1>
      <p>Install the signed desktop app to enable remote control, screen preview, and AI Assist on your local machine.</p>

      {loading ? (
        <p style={{ marginTop: '1rem', color: '#666' }}>Loading current desktop release...</p>
      ) : requiresSubscription ? (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: '#fff7ed',
            border: '1px solid #fdba74',
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: 0, color: '#9a3412' }}>
            An active subscription is required to access desktop downloads.
          </p>
          <Link href="/billing" style={{ display: 'inline-block', marginTop: '0.75rem', color: '#2563eb' }}>
            Subscribe to download
          </Link>
        </div>
      ) : error ? (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
          }}
        >
          {error}
        </div>
      ) : downloads ? (
        <>
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1rem',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: '#0f172a' }}>
              Current desktop version: {downloads.version}
            </p>
            {downloads.notes ? (
              <p style={{ margin: '0.5rem 0 0', color: '#475569' }}>{downloads.notes}</p>
            ) : null}
            {downloads.publishedAt ? (
              <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
                Published: {new Date(downloads.publishedAt).toLocaleString()}
              </p>
            ) : null}
          </div>

          <div style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
            <a
              href={downloads.windowsUrl}
              style={{
                display: 'inline-block',
                padding: '1rem 1.25rem',
                backgroundColor: '#111827',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Download for Windows
            </a>
            <a
              href={downloads.macArmUrl}
              style={{
                display: 'inline-block',
                padding: '1rem 1.25rem',
                backgroundColor: '#111827',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Download for macOS (Apple Silicon)
            </a>
            <a
              href={downloads.macIntelUrl}
              style={{
                display: 'inline-block',
                padding: '1rem 1.25rem',
                backgroundColor: '#111827',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Download for macOS (Intel)
            </a>
          </div>
        </>
      ) : null}
    </main>
  );
}
