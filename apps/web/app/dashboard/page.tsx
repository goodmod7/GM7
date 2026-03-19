'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  CreditCard,
  Download,
  HardDrive,
  Laptop,
  LogOut,
  Server,
  Shield,
  Sparkles,
  Terminal,
  UserRound,
} from 'lucide-react';
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
import { Badge, Banner, Button, Card } from '../../components/ui';

interface Device {
  deviceId: string;
  deviceName?: string;
  platform: string;
  connected: boolean;
  paired: boolean;
  lastSeenAt: string | number;
  workspaceState?: {
    configured: boolean;
    rootName?: string;
  };
}

function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'Unknown';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString();
}

function getDeviceName(device: Device): string {
  return device.deviceName?.trim() || `Desktop-${device.deviceId.slice(0, 8)}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [downloads, setDownloads] = useState<DesktopDownloadInfo | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        setError(null);

        const user = await getMe();
        if (!active) {
          return;
        }

        if (!user) {
          router.replace('/login');
          return;
        }

        setUserEmail(user.email);

        const [devicesResponse, sessionsData, billingStatus, downloadInfo] = await Promise.all([
          apiFetch('/devices'),
          getSessions(),
          getBillingStatus(),
          getDesktopDownloads(),
        ]);

        if (!active) {
          return;
        }

        if (devicesResponse.status === 401) {
          router.replace('/login');
          return;
        }

        const devicesPayload = await devicesResponse.json().catch(() => ({ error: 'Failed to fetch devices' }));
        if (!devicesResponse.ok) {
          throw new Error(devicesPayload.error || 'Failed to fetch devices');
        }

        setDevices((devicesPayload.devices || []) as Device[]);
        setSessions(sessionsData);
        setBilling(billingStatus);
        setDownloads(downloadInfo);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
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
  }, [router]);

  const signedInDesktops = devices.filter((device) => device.paired);
  const onlineCount = signedInDesktops.filter((device) => device.connected).length;
  const configuredWorkspaces = signedInDesktops.filter((device) => device.workspaceState?.configured).length;
  const hasActiveSubscription = billing?.subscriptionStatus === 'active';

  if (loading) {
    return (
      <main className="page--wide">
        <Card>
          <div className="banner">
            <Activity size={16} className="spinner" />
            Loading dashboard...
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="page--wide">
      <section className="hero">
        <Badge>
          <Sparkles size={14} />
          Retail dashboard
        </Badge>
        <div className="split">
          <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
            <div className="stack" style={{ gap: 10 }}>
              <p className="section-title" style={{ marginBottom: 0 }}>
                Command center
              </p>
              <h1 className="hero__title" style={{ fontSize: 'clamp(2.7rem, 5vw, 4.6rem)' }}>
                Desktop First
              </h1>
              <p className="hero__subtitle">
                Desktop is the primary place to start tasks. Use the desktop app to start tasks, then use this
                website for account management, Downloads, Billing, Signed-in desktops, and Older Desktop
                Tools when you need the legacy browser surface.
              </p>
            </div>

            <div className="hero__actions">
              <Link href="/download" className="button">
                <Download size={16} />
                Downloads
              </Link>
              <Link href="/billing" className="button button--secondary">
                <CreditCard size={16} />
                Billing
              </Link>
              <Link href="/dashboard/legacy" className="button button--secondary">
                <Terminal size={16} />
                Older Desktop Tools
              </Link>
            </div>
          </div>

          <Card subtle style={{ minWidth: 280, width: 'min(100%, 340px)' }}>
            <div className="stack" style={{ gap: 18 }}>
              <div className="split">
                <div>
                  <p className="section-title" style={{ marginBottom: 0 }}>
                    Account
                  </p>
                  <p className="device-name" style={{ marginTop: 10 }}>
                    {userEmail || 'Signed in'}
                  </p>
                </div>
                <UserRound size={22} color="rgba(255,255,255,0.44)" />
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <p className="small-note">Browser sessions: {sessions.length}</p>
                <p className="small-note">
                  Subscription: {hasActiveSubscription ? 'Active' : 'Inactive'}
                </p>
                <p className="small-note">
                  Signed-in desktops: {signedInDesktops.length}
                </p>
              </div>

              <Button
                variant="ghost"
                style={{ width: 'fit-content' }}
                onClick={() => {
                  void (async () => {
                    try {
                      await logout();
                    } finally {
                      router.push('/login');
                    }
                  })();
                }}
              >
                <LogOut size={16} />
                Logout
              </Button>
            </div>
          </Card>
        </div>
      </section>

      {error ? (
        <div style={{ marginTop: 24 }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : null}

      <section className="desktop-summary-grid" style={{ marginTop: 24 }}>
        <Card hover>
          <div className="split">
            <div>
              <p className="section-title" style={{ marginBottom: 0 }}>
                Account
              </p>
              <h2 className="section-heading" style={{ fontSize: 24, marginTop: 10 }}>
                {userEmail || 'Signed in'}
              </h2>
            </div>
            <UserRound size={22} color="rgba(255,255,255,0.38)" />
          </div>
          <p className="copy" style={{ marginTop: 16 }}>
            Active browser sign-ins: {sessions.length}. Use the desktop app itself for real task execution.
          </p>
        </Card>

        <Card hover>
          <div className="split">
            <div>
              <p className="section-title" style={{ marginBottom: 0 }}>
                Billing
              </p>
              <h2 className="section-heading" style={{ fontSize: 24, marginTop: 10 }}>
                {hasActiveSubscription ? 'Active' : 'Inactive'}
              </h2>
            </div>
            <Shield size={22} color="rgba(255,255,255,0.38)" />
          </div>
          <p className="copy" style={{ marginTop: 16 }}>
            {hasActiveSubscription
              ? 'Premium browser-controlled flows are unlocked for this account.'
              : 'Free local desktop usage is available without a subscription.'}
          </p>
          {billing?.subscriptionCurrentPeriodEnd ? (
            <p className="small-note mono" style={{ marginTop: 12 }}>
              Current period ends: {formatDateTime(billing.subscriptionCurrentPeriodEnd)}
            </p>
          ) : null}
        </Card>

        <Card hover>
          <div className="split">
            <div>
              <p className="section-title" style={{ marginBottom: 0 }}>
                Downloads
              </p>
              <h2 className="section-heading" style={{ fontSize: 24, marginTop: 10 }}>
                {downloads ? `v${downloads.version}` : 'Unavailable'}
              </h2>
            </div>
            <HardDrive size={22} color="rgba(255,255,255,0.38)" />
          </div>
          <p className="copy" style={{ marginTop: 16 }}>
            Install the signed desktop app, sign in there, and keep the web surface focused on support tasks.
          </p>
          <Link href="/download" className="button button--secondary" style={{ marginTop: 18, width: 'fit-content' }}>
            Download Desktop
            <ArrowRight size={16} />
          </Link>
        </Card>
      </section>

      <Card style={{ marginTop: 24 }}>
        <div className="split">
          <div className="stack" style={{ gap: 10 }}>
            <div className="eyebrow">
              <Server size={14} />
              Signed-in desktops
            </div>
            <h2 className="section-heading">Signed-in desktops</h2>
            <p className="copy" style={{ maxWidth: 720 }}>
              Keep track of connected machines and workspace readiness here. Task creation, approvals, and live
              execution still belong in the desktop app.
            </p>
          </div>
          <div className="stack" style={{ gap: 10, minWidth: 220 }}>
            <Badge tone={onlineCount > 0 ? 'success' : 'warning'}>
              <Laptop size={14} />
              {onlineCount}/{signedInDesktops.length || 0} online
            </Badge>
            <p className="small-note mono">Configured workspaces: {configuredWorkspaces}</p>
          </div>
        </div>

        {signedInDesktops.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 22 }}>
            No signed-in desktops yet. Download the desktop app, sign in there, and the machine will appear here.
          </div>
        ) : (
          <div className="device-list" style={{ marginTop: 22 }}>
            {signedInDesktops.map((device) => (
              <div key={device.deviceId} className="device-row">
                <div className="device-row__header">
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row-actions" style={{ gap: 10, alignItems: 'center' }}>
                      <p className="device-name">{getDeviceName(device)}</p>
                      <Badge tone={device.connected ? 'success' : 'warning'}>
                        {device.connected ? 'Connected' : 'Offline'}
                      </Badge>
                    </div>
                    <p className="device-meta mono">
                      {device.platform} • {device.deviceId} • Last seen {formatDateTime(device.lastSeenAt)}
                    </p>
                    <p className="device-meta">
                      Workspace:{' '}
                      {device.workspaceState?.configured
                        ? device.workspaceState.rootName || 'Configured'
                        : 'Not configured'}
                    </p>
                  </div>

                  <div className="row-actions">
                    <Link href="/download" className="button button--ghost">
                      Downloads
                    </Link>
                    <Link href="/dashboard/legacy" className="button button--secondary">
                      Manage
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
