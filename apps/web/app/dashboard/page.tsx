'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  apiFetch,
  getBillingStatus,
  getDesktopDownloads,
  getMe,
  getSessions,
  logout,
  type BillingStatus,
  type BrowserSession,
  type DesktopDownloadInfo,
} from '../../lib/auth';

interface Device {
  deviceId: string;
  deviceName?: string;
  platform: string;
  connected: boolean;
  paired: boolean;
  lastSeenAt: number;
  workspaceState?: {
    configured: boolean;
    rootName?: string;
  };
}

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [downloads, setDownloads] = useState<DesktopDownloadInfo | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const user = await getMe();
      if (!user) {
        router.replace('/login');
        return;
      }

      setUserEmail(user.email);

      const [devicesRes, sessionsData, billingStatus, downloadInfo] = await Promise.all([
        apiFetch('/devices'),
        getSessions(),
        getBillingStatus(),
        getDesktopDownloads(),
      ]);

      if (!devicesRes.ok) {
        throw new Error('Failed to fetch devices');
      }

      const devicesData = await devicesRes.json();
      setDevices(devicesData.devices || []);
      setSessions(sessionsData);
      setBilling(billingStatus);
      setDownloads(downloadInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString();
  const activeDevices = devices.filter((device) => device.paired);

  if (loading) {
    return (
      <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <Link href="/" style={{ color: '#0070f3', textDecoration: 'none' }}>
          ← Back to Home
        </Link>
        <p style={{ marginTop: '2rem' }}>Loading dashboard...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#0070f3', textDecoration: 'none' }}>
        ← Back to Home
      </Link>

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <p style={{ margin: '0.35rem 0 0', color: '#6b7280' }}>
            Desktop is the primary place to start tasks. Use this dashboard for account, downloads, billing, devices, and migration fallback.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {userEmail && <span style={{ fontSize: '0.875rem', color: '#374151' }}>{userEmail}</span>}
          <button
            onClick={() => {
              void (async () => {
                try {
                  await logout();
                } finally {
                  router.push('/login');
                }
              })();
            }}
            style={{
              padding: '0.45rem 0.8rem',
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.9rem 1rem',
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            color: '#991b1b',
          }}
        >
          {error}
        </div>
      )}

      <section
        style={{
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
          border: '1px solid #bfdbfe',
          borderRadius: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: '280px', flex: '1 1 420px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1d4ed8' }}>
              Desktop First
            </div>
            <h2 style={{ margin: '0.5rem 0 0', fontSize: '1.5rem' }}>Use the desktop app to start tasks</h2>
            <p style={{ margin: '0.75rem 0 0', color: '#475569', maxWidth: '52ch', lineHeight: 1.6 }}>
              Sign in from the desktop app, complete browser auth, and run tasks directly there. The website is now secondary for account, billing, downloads, devices, and admin/debug fallback.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link
              href="/download"
              style={{
                padding: '0.75rem 1rem',
                background: '#1d4ed8',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Downloads
            </Link>
            <Link
              href="/billing"
              style={{
                padding: '0.75rem 1rem',
                background: 'white',
                color: '#1f2937',
                borderRadius: '8px',
                textDecoration: 'none',
                border: '1px solid #d1d5db',
                fontWeight: 600,
              }}
            >
              Billing
            </Link>
            <Link
              href="/dashboard/legacy"
              style={{
                padding: '0.75rem 1rem',
                background: '#f8fafc',
                color: '#334155',
                borderRadius: '8px',
                textDecoration: 'none',
                border: '1px dashed #94a3b8',
                fontWeight: 600,
              }}
            >
              Admin / Legacy Tools
            </Link>
          </div>
        </div>
      </section>

      <div
        style={{
          marginTop: '1.5rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1rem',
        }}
      >
        <section style={{ padding: '1rem', background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Account</h2>
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.875rem', color: '#374151' }}>
            {userEmail || 'Signed in'}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            Browser sessions: {sessions.length}
          </p>
        </section>

        <section style={{ padding: '1rem', background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Billing</h2>
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.875rem', color: billing?.subscriptionStatus === 'active' ? '#166534' : '#991b1b' }}>
            {billing?.subscriptionStatus === 'active' ? 'Subscription active' : 'Subscription inactive'}
          </p>
          {billing?.subscriptionCurrentPeriodEnd && (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
              Renews / ends: {new Date(billing.subscriptionCurrentPeriodEnd).toLocaleString()}
            </p>
          )}
        </section>

        <section style={{ padding: '1rem', background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Downloads</h2>
          {downloads ? (
            <>
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.875rem', color: '#374151' }}>
                Current desktop version: {downloads.version}
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
                Install the desktop app, click Sign in, and use it directly.
              </p>
            </>
          ) : (
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
              Desktop download info is unavailable for this account right now.
            </p>
          )}
        </section>
      </div>

      <section style={{ marginTop: '1.5rem', padding: '1rem', background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Devices</h2>
        <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
          Signed-in desktops stay visible here for account and debug purposes, but task creation belongs in the desktop app.
        </p>

        {activeDevices.length === 0 ? (
          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
            No signed-in desktops yet. Install the desktop app and sign in from there.
          </p>
        ) : (
          <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
            {activeDevices.map((device) => (
              <div
                key={device.deviceId}
                style={{
                  padding: '0.9rem 1rem',
                  background: '#f9fafb',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{device.deviceName || `Desktop-${device.deviceId.slice(0, 8)}`}</div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#6b7280' }}>
                      {device.platform} • {device.connected ? 'Connected' : 'Offline'} • Last seen {formatTime(device.lastSeenAt)}
                    </div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#6b7280' }}>
                      Workspace: {device.workspaceState?.configured ? device.workspaceState.rootName || 'Configured' : 'Not configured'}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#1d4ed8', fontWeight: 600 }}>
                    {device.paired ? 'Signed in' : 'Legacy / unpaired'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
