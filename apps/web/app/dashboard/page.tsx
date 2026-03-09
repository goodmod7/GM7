'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, buildApiUrl, getBillingStatus, getMe, getSessions, logout, logoutAllSessions, type BillingStatus, type BrowserSession } from '../../lib/auth';

interface Device {
  deviceId: string;
  deviceName?: string;
  platform: string;
  connected: boolean;
  paired: boolean;
  pairingCode?: string;
  pairingExpiresAt?: number;
  lastSeenAt: number;
  screenStreamState?: {
    enabled: boolean;
    fps: 1 | 2;
    displayId?: string;
  };
  controlState?: {
    enabled: boolean;
    updatedAt: number;
    requestedBy?: string;
  };
  // Iteration 8: Workspace state
  workspaceState?: {
    configured: boolean;
    rootName?: string;
  };
}

interface LogLine {
  line: string;
  level: 'info' | 'warn' | 'error';
  at: number;
}

interface RunStep {
  stepId: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked';
  startedAt?: number;
  endedAt?: number;
  logs: LogLine[];
}

// Iteration 6: Agent Proposal types
interface ProposeActionProposal {
  kind: 'propose_action';
  action: {
    kind: 'click' | 'double_click' | 'scroll' | 'type' | 'hotkey';
    [key: string]: unknown;
  };
  rationale: string;
  confidence?: number;
}

interface ProposeToolProposal {
  kind: 'propose_tool';
  toolCall: {
    tool: 'fs.list' | 'fs.read_text' | 'fs.write_text' | 'fs.apply_patch' | 'terminal.exec';
    path?: string;
    cmd?: string;
  };
  rationale: string;
  confidence?: number;
}

interface AskUserProposal {
  kind: 'ask_user';
  question: string;
}

interface DoneProposal {
  kind: 'done';
  summary: string;
}

type AgentProposal = ProposeActionProposal | ProposeToolProposal | AskUserProposal | DoneProposal;

interface Run {
  runId: string;
  deviceId: string;
  goal: string;
  status: 'queued' | 'running' | 'waiting_for_user' | 'done' | 'failed' | 'canceled';
  createdAt: number;
  updatedAt: number;
  reason?: string;
  steps: RunStep[];
  // Iteration 6: AI Assist fields
  mode?: 'manual' | 'ai_assist';
  constraints?: {
    maxActions: number;
    maxRuntimeMinutes: number;
  };
  actionCount?: number;
  lastAgentEventAt?: number;
  latestProposal?: AgentProposal;
}

interface ScreenFrameMeta {
  frameId: string;
  width: number;
  height: number;
  mime: 'image/png';
  at: number;
  byteLength: number;
}

interface DeviceAction {
  actionId: string;
  deviceId: string;
  action: {
    kind: 'click' | 'double_click' | 'scroll' | 'type' | 'hotkey';
    [key: string]: unknown;
  };
  status: 'requested' | 'awaiting_user' | 'approved' | 'denied' | 'executed' | 'failed';
  createdAt: number;
  updatedAt: number;
  error?: { code: string; message: string };
  source?: 'web' | 'agent';
  runId?: string;
}

// Iteration 8: Tool Summary type
type ToolEventStatus = 'requested' | 'awaiting_user' | 'approved' | 'denied' | 'executed' | 'failed';

interface ToolSummary {
  toolEventId: string;
  toolCallId: string;
  runId?: string;
  deviceId: string;
  tool: 'fs.list' | 'fs.read_text' | 'fs.write_text' | 'fs.apply_patch' | 'terminal.exec';
  pathRel?: string;
  cmd?: string;
  status: ToolEventStatus;
  exitCode?: number;
  truncated?: boolean;
  bytesWritten?: number;
  hunksApplied?: number;
  errorCode?: string;
  at: number;
}

interface SSEEvent {
  type: 'connected' | 'device_update' | 'run_update' | 'step_update' | 'log_line' | 'screen_update' | 'action_update' | 'tool_update';
  run?: Run;
  step?: RunStep;
  runId?: string;
  stepId?: string;
  log?: LogLine;
  clientId?: string;
  deviceId?: string;
  meta?: ScreenFrameMeta;
  action?: DeviceAction;
  tool?: ToolSummary;
}

const hotkeyBtnStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  borderRadius: '4px',
  border: '1px solid #d1d5db',
  background: '#f9fafb',
  cursor: 'pointer',
  fontSize: '0.75rem',
};

export default function Dashboard() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [pairingInputs, setPairingInputs] = useState<Record<string, string>>({});
  const [pairingLoading, setPairingLoading] = useState<Record<string, boolean>>({});
  const [newRunGoal, setNewRunGoal] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedRunMode, setSelectedRunMode] = useState<'manual' | 'ai_assist'>('manual');
  
  // Screen preview state
  const [previewDeviceId, setPreviewDeviceId] = useState<string | null>(null);
  const [screenMeta, setScreenMeta] = useState<ScreenFrameMeta | null>(null);
  const [screenTimestamp, setScreenTimestamp] = useState<number>(0);
  
  // Control state
  const [actions, setActions] = useState<DeviceAction[]>([]);
  const [typeText, setTypeText] = useState('');
  
  // Iteration 8: Tool timeline state (per runId)
  const [runTools, setRunTools] = useState<Record<string, ToolSummary[]>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const user = await getMe();
        if (!active) {
          return;
        }

        if (!user) {
          router.replace('/login');
          return;
        }

        setUserEmail(user.email);
        setAuthReady(true);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load session');
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  // Fetch initial data
  const fetchInitialData = useCallback(async () => {
    if (!authReady) return;
    try {
      setError(null);
      
      const devicesRes = await apiFetch('/devices');
      if (devicesRes.status === 401) {
        router.replace('/login');
        return;
      }
      if (!devicesRes.ok) throw new Error('Failed to fetch devices');
      const devicesData = await devicesRes.json();
      setDevices(devicesData.devices || []);

      const runsRes = await apiFetch('/runs');
      if (runsRes.status === 401) {
        router.replace('/login');
        return;
      }
      if (!runsRes.ok) throw new Error('Failed to fetch runs');
      const runsData = await runsRes.json();
      setRuns(runsData.runs || []);

      const sessionsData = await getSessions();
      setSessions(sessionsData);

      const billingStatus = await getBillingStatus();
      setBilling(billingStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [authReady, router]);

  // Setup SSE connection
  useEffect(() => {
    if (!authReady) {
      return;
    }

    fetchInitialData();

    const setupSSE = () => {
      let opened = false;
      const es = new EventSource(buildApiUrl('/events', { includeAccessTokenQuery: true }), { withCredentials: true });

      es.onopen = () => {
        opened = true;
        console.log('[SSE] Connected');
        setSseConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data: SSEEvent = JSON.parse(event.data);
          console.log('[SSE] Received:', data.type);

          switch (data.type) {
            case 'run_update':
              if (data.run) {
                const updatedRun = data.run;
                setRuns((prev) => {
                  const existing = prev.find((r) => r.runId === updatedRun.runId);
                  if (existing) {
                    return prev.map((r) => (r.runId === updatedRun.runId ? updatedRun : r));
                  }
                  return [...prev, updatedRun];
                });
              }
              break;

            case 'step_update':
              if (data.runId && data.step) {
                setRuns((prev) =>
                  prev.map((r) => {
                    if (r.runId === data.runId) {
                      return {
                        ...r,
                        steps: r.steps.map((s) =>
                          s.stepId === data.step!.stepId ? data.step! : s
                        ),
                      };
                    }
                    return r;
                  })
                );
              }
              break;

            case 'screen_update':
              if (data.deviceId && data.meta) {
                setScreenMeta(data.meta);
                setScreenTimestamp(Date.now());
              }
              break;

            case 'action_update':
              if (data.action) {
                const updatedAction = data.action;
                setActions((prev) => {
                  const existing = prev.find((a) => a.actionId === updatedAction.actionId);
                  if (existing) {
                    return prev.map((a) => (a.actionId === updatedAction.actionId ? updatedAction : a));
                  }
                  return [updatedAction, ...prev].slice(0, 20);
                });
              }
              break;

            case 'tool_update':
              if (data.tool) {
                const tool = data.tool;
                if (tool.runId) {
                  setRunTools((prev) => {
                    const existing = prev[tool.runId!]?.find((t) => t.toolEventId === tool.toolEventId);
                    let updated;
                    if (existing) {
                      updated = {
                        ...prev,
                        [tool.runId!]: prev[tool.runId!].map((t) =>
                          t.toolEventId === tool.toolEventId ? tool : t
                        ),
                      };
                    } else {
                      updated = {
                        ...prev,
                        [tool.runId!]: [tool, ...(prev[tool.runId!] || [])].slice(0, 50),
                      };
                    }
                    return updated;
                  });
                }
              }
              break;
          }
        } catch (err) {
          console.error('[SSE] Failed to parse message:', err);
        }
      };

      es.onerror = (err) => {
        console.error('[SSE] Error:', err);
        setSseConnected(false);
        if (!opened) {
          setError('Please log in again');
          es.close();
          return;
        }
        setTimeout(() => {
          if (es.readyState === EventSource.CLOSED) {
            setupSSE();
          }
        }, 3000);
      };

      return es;
    };

    const es = setupSSE();

    // Poll devices every 3 seconds
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch('/devices');
        if (res.ok) {
          const data = await res.json();
          setDevices(data.devices || []);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => {
      clearInterval(interval);
      es.close();
    };
  }, [authReady, fetchInitialData]);

  const handlePairSubmit = async (deviceId: string) => {
    const code = pairingInputs[deviceId]?.trim().toUpperCase();
    if (!code) return;

    setPairingLoading((prev) => ({ ...prev, [deviceId]: true }));
    
    try {
      const res = await apiFetch(`/devices/${deviceId}/pair`, {
        method: 'POST',
        body: JSON.stringify({ pairingCode: code }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Pairing failed');
      }

      setPairingInputs((prev) => ({ ...prev, [deviceId]: '' }));
      
      const devicesRes = await apiFetch('/devices');
      if (devicesRes.ok) {
        const data = await devicesRes.json();
        setDevices(data.devices || []);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setPairingLoading((prev) => ({ ...prev, [deviceId]: false }));
    }
  };

  const handleCreateRun = async () => {
    if (billing?.subscriptionStatus !== 'active') {
      alert('An active subscription is required to create runs.');
      return;
    }
    if (!selectedDeviceId || !newRunGoal.trim()) return;

    try {
      const res = await apiFetch('/runs', {
        method: 'POST',
        body: JSON.stringify({ 
          deviceId: selectedDeviceId, 
          goal: newRunGoal,
          mode: selectedRunMode,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create run');
      }

      setNewRunGoal('');
      
      const runsRes = await apiFetch('/runs');
      if (runsRes.ok) {
        const data = await runsRes.json();
        setRuns(data.runs || []);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create run');
    }
  };

  const handleCancelRun = async (runId: string) => {
    try {
      const res = await apiFetch(`/runs/${runId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Canceled from dashboard' }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to cancel run');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel run');
    }
  };

  const handleSelectRunTools = async (runId: string) => {
    setSelectedRunId(runId);

    try {
      const res = await apiFetch(`/runs/${runId}/tools`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch tool timeline');
      }

      const data = await res.json();
      setRunTools((prev) => ({
        ...prev,
        [runId]: data.tools || [],
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to fetch tool timeline');
    }
  };

  const handleLogoutAll = async () => {
    try {
      await logoutAllSessions();
      router.push('/login');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to log out all sessions');
    }
  };

  // Send control action
  const sendAction = async (action: DeviceAction['action']) => {
    if (billing?.subscriptionStatus !== 'active') {
      alert('An active subscription is required for remote control.');
      return;
    }
    if (!previewDeviceId) return;
    
    try {
      const res = await apiFetch(`/devices/${previewDeviceId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send action');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send action');
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    sendAction({ kind: 'click', x, y, button: 'left' });
  };

  const handleTypeSubmit = () => {
    if (!typeText.trim()) return;
    sendAction({ kind: 'type', text: typeText });
    setTypeText('');
  };

  const handleHotkey = (key: string, modifiers?: string[]) => {
    sendAction({ kind: 'hotkey', key, modifiers });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    sendAction({ kind: 'scroll', dx: e.deltaX, dy: e.deltaY });
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getTimeRemaining = (expiresAt: number): string => {
    const remaining = Math.max(0, expiresAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const pairedDevices = devices.filter((d) => d.paired);
  const previewDevice = previewDeviceId ? devices.find((d) => d.deviceId === previewDeviceId) : null;
  const hasActiveSubscription = billing?.subscriptionStatus === 'active';

  const getCompletedStepsCount = (run: Run): number => {
    return run.steps.filter((s) => s.status === 'done').length;
  };

  // Helper to summarize action for display
  const summarizeAction = (action: DeviceAction['action']): string => {
    switch (action.kind) {
      case 'type':
        const text = action.text as string;
        return `Type (${text.length} chars)`;
      case 'click':
        return `Click at (${((action.x as number) * 100).toFixed(0)}%, ${((action.y as number) * 100).toFixed(0)}%)`;
      case 'double_click':
        return `Double-click`;
      case 'scroll':
        return `Scroll`;
      case 'hotkey':
        return `Hotkey ${action.key}`;
      default:
        return action.kind;
    }
  };

  if (loading) {
    return (
      <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <Link href="/" style={{ color: '#0070f3', textDecoration: 'none' }}>
          ← Back to Home
        </Link>
        <p style={{ marginTop: '2rem' }}>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#0070f3', textDecoration: 'none' }}>
        ← Back to Home
      </Link>

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {userEmail && <span style={{ fontSize: '0.875rem', color: '#374151' }}>{userEmail}</span>}
          <button
            onClick={() => {
              void (async () => {
                try {
                  await logout();
                } catch (err) {
                  console.error('[Auth] Logout failed:', err);
                } finally {
                  router.push('/login');
                }
              })();
            }}
            style={{
              padding: '0.4rem 0.75rem',
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

      {/* Connection Status */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <StatusBadge
          label={sseConnected ? 'Live Updates' : 'Reconnecting...'}
          color={sseConnected ? '#10b981' : '#f59e0b'}
        />
      </div>

      {error && (
        <div
          style={{
            padding: '1rem',
            background: '#fee2e2',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            color: '#dc2626',
            marginBottom: '1rem',
          }}
        >
          Error: {error}
        </div>
      )}

      {!hasActiveSubscription && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#fff7ed',
            border: '1px solid #fdba74',
            borderRadius: '8px',
            color: '#9a3412',
          }}
        >
          Subscription required to start runs and use remote control. <Link href="/billing">Go to Billing</Link>.
        </div>
      )}

      <section
        style={{
          marginTop: '1rem',
          padding: '1rem',
          background: 'white',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Sessions</h2>
            <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
              Active and recent browser sessions for this account
            </p>
          </div>
          <button
            onClick={() => {
              void handleLogoutAll();
            }}
            style={{
              padding: '0.45rem 0.8rem',
              background: '#fff7ed',
              border: '1px solid #fdba74',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Logout All Sessions
          </button>
        </div>

        {sessions.length === 0 ? (
          <p style={{ marginTop: '0.75rem', color: '#6b7280', fontSize: '0.875rem' }}>No active sessions found.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
            {sessions.map((session) => (
              <div
                key={session.id}
                style={{
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  background: '#f9fafb',
                }}
              >
                <div style={{ fontSize: '0.875rem', color: '#111827' }}>
                  Created: {formatTime(new Date(session.createdAt).getTime())} • Last used: {formatTime(new Date(session.lastUsedAt).getTime())}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  Expires: {formatTime(new Date(session.expiresAt).getTime())}
                  {session.revokedAt ? ` • Revoked: ${formatTime(new Date(session.revokedAt).getTime())}` : ''}
                </div>
                {session.userAgent && (
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    {session.userAgent}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: previewDeviceId ? '1fr 400px' : '1fr', gap: '2rem' }}>
        <div>
          {/* Devices Section */}
          <section style={{ marginTop: '2rem' }}>
            <h2>Devices</h2>
            
            {devices.length === 0 ? (
              <p style={{ color: '#666' }}>No devices connected.</p>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {devices.map((device) => (
                  <div
                    key={device.deviceId}
                    style={{
                      padding: '1rem',
                      background: 'white',
                      borderRadius: '8px',
                      border: '1px solid #e0e0e0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>
                          {device.deviceName || `Device-${device.deviceId.slice(0, 8)}`}
                        </h3>
                        <p style={{ margin: '0.25rem 0', color: '#666', fontSize: '0.875rem' }}>
                          ID: <code>{device.deviceId}</code>
                        </p>
                        <p style={{ margin: '0.25rem 0', color: '#666', fontSize: '0.875rem' }}>
                          Platform: {device.platform} • Last seen: {formatTime(device.lastSeenAt)}
                        </p>
                        {device.screenStreamState?.enabled && (
                          <p style={{ margin: '0.25rem 0', fontSize: '0.75rem', color: '#10b981' }}>
                            📹 Screen sharing active ({device.screenStreamState.fps} FPS)
                          </p>
                        )}
                        {/* Iteration 8: Workspace badge */}
                        {device.workspaceState?.configured ? (
                          <p style={{ margin: '0.25rem 0', fontSize: '0.75rem', color: '#3b82f6' }}>
                            📁 Workspace: {device.workspaceState.rootName}
                          </p>
                        ) : (
                          <p style={{ margin: '0.25rem 0', fontSize: '0.75rem', color: '#9ca3af' }}>
                            📁 Workspace: Not configured
                          </p>
                        )}
                      </div>
                      
                      <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <StatusBadge
                            label={device.connected ? 'Connected' : 'Offline'}
                            color={device.connected ? '#10b981' : '#6b7280'}
                          />
                          <StatusBadge
                            label={device.paired ? 'Paired' : 'Unpaired'}
                            color={device.paired ? '#3b82f6' : '#f59e0b'}
                          />
                        </div>
                        {device.paired && device.screenStreamState?.enabled && (
                          <button
                            onClick={() => setPreviewDeviceId(device.deviceId)}
                            style={{
                              padding: '0.25rem 0.75rem',
                              backgroundColor: previewDeviceId === device.deviceId ? '#10b981' : '#f3f4f6',
                              color: previewDeviceId === device.deviceId ? 'white' : '#374151',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            {previewDeviceId === device.deviceId ? 'Viewing' : 'View Screen'}
                          </button>
                        )}
                      </div>
                    </div>

                    {!device.paired && device.pairingCode && device.pairingExpiresAt && (
                      <div
                        style={{
                          marginTop: '1rem',
                          padding: '0.75rem',
                          background: '#fef3c7',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                        }}
                      >
                        <strong>Pairing Code:</strong> {device.pairingCode}
                        <span style={{ color: '#666', marginLeft: '0.5rem' }}>
                          (expires in {getTimeRemaining(device.pairingExpiresAt)})
                        </span>
                      </div>
                    )}

                    {!device.paired && (
                      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                        <input
                          type="text"
                          placeholder="Enter pairing code"
                          value={pairingInputs[device.deviceId] || ''}
                          onChange={(e) =>
                            setPairingInputs((prev) => ({
                              ...prev,
                              [device.deviceId]: e.target.value,
                            }))
                          }
                          style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '4px',
                            border: '1px solid #ddd',
                            fontSize: '0.875rem',
                            textTransform: 'uppercase',
                          }}
                        />
                        <button
                          onClick={() => handlePairSubmit(device.deviceId)}
                          disabled={pairingLoading[device.deviceId] || !pairingInputs[device.deviceId]?.trim()}
                          style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: '#0070f3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                          }}
                        >
                          {pairingLoading[device.deviceId] ? 'Pairing...' : 'Pair'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Create Run Section */}
          {pairedDevices.length > 0 && (
            <section style={{ marginTop: '2rem', padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
              <h2 style={{ marginTop: 0 }}>Create Run</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    Device
                  </label>
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    disabled={!hasActiveSubscription}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd',
                      fontSize: '0.875rem',
                    }}
                  >
                    <option value="">Select device</option>
                    {pairedDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.deviceName || d.deviceId.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    Mode
                  </label>
                  <select
                    value={selectedRunMode}
                    onChange={(e) => setSelectedRunMode(e.target.value as 'manual' | 'ai_assist')}
                    disabled={!hasActiveSubscription}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd',
                      fontSize: '0.875rem',
                    }}
                  >
                    <option value="manual">Manual</option>
                    <option value="ai_assist">🤖 AI Assist</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    Goal
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Open Chrome and search for..."
                    value={newRunGoal}
                    onChange={(e) => setNewRunGoal(e.target.value)}
                    disabled={!hasActiveSubscription}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
                <button
                  onClick={handleCreateRun}
                  disabled={!hasActiveSubscription || !selectedDeviceId || !newRunGoal.trim()}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: hasActiveSubscription && selectedDeviceId && newRunGoal.trim() ? '#10b981' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: hasActiveSubscription && selectedDeviceId && newRunGoal.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '0.875rem',
                  }}
                >
                  Create Run
                </button>
              </div>
              {selectedRunMode === 'ai_assist' && (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#8b5cf6' }}>
                  🤖 AI Assist: The AI will analyze the screen and propose actions one at a time.
                  Every action requires explicit user approval on the desktop.
                </p>
              )}
            </section>
          )}

          {/* Runs Section */}
          <section style={{ marginTop: '2rem' }}>
            <h2>Runs ({runs.length})</h2>
            
            {runs.length === 0 ? (
              <p style={{ color: '#666' }}>No runs yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {runs.slice().reverse().map((run) => (
                  <div
                    key={run.runId}
                    style={{
                      padding: '1rem',
                      background: 'white',
                      borderRadius: '8px',
                      border: '1px solid #e0e0e0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <p style={{ margin: 0, fontWeight: 500 }}>{run.goal}</p>
                          {run.mode === 'ai_assist' && (
                            <span
                              style={{
                                padding: '0.125rem 0.5rem',
                                backgroundColor: '#8b5cf620',
                                color: '#8b5cf6',
                                borderRadius: '9999px',
                                fontSize: '0.625rem',
                                fontWeight: 600,
                              }}
                            >
                              AI ASSIST
                            </span>
                          )}
                        </div>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                          ID: {run.runId.slice(0, 8)}... • Device: {run.deviceId.slice(0, 8)}... • 
                          Created: {formatTime(run.createdAt)}
                        </p>
                        {run.mode === 'ai_assist' && run.constraints && (
                          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                            Actions: {run.actionCount || 0} / {run.constraints.maxActions} • 
                            Max runtime: {run.constraints.maxRuntimeMinutes} min
                          </p>
                        )}
                        {run.steps.length > 0 && (
                          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
                            Progress: {getCompletedStepsCount(run)}/{run.steps.length} steps
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <StatusBadge
                          label={run.status}
                          color={
                            run.status === 'done'
                              ? '#10b981'
                              : run.status === 'failed'
                              ? '#ef4444'
                              : run.status === 'canceled'
                              ? '#6b7280'
                              : run.status === 'running'
                              ? '#3b82f6'
                              : run.status === 'waiting_for_user'
                              ? '#8b5cf6'
                              : '#f59e0b'
                          }
                        />
                        {(run.status === 'queued' || run.status === 'running' || run.status === 'waiting_for_user') && (
                          <button
                            onClick={() => handleCancelRun(run.runId)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              backgroundColor: '#fee2e2',
                              color: '#dc2626',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={() => handleSelectRunTools(run.runId)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: selectedRunId === run.runId ? '#dbeafe' : '#f3f4f6',
                            color: selectedRunId === run.runId ? '#1d4ed8' : '#374151',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          Tools
                        </button>
                      </div>
                    </div>

                    {/* AI Assist: Latest Proposal */}
                    {run.mode === 'ai_assist' && run.latestProposal && (
                      <div
                        style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          background: '#fef3c7',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                        }}
                      >
                        <strong style={{ color: '#92400e' }}>🤖 Latest AI Proposal:</strong>
                        {run.latestProposal.kind === 'propose_action' && (
                          <div style={{ marginTop: '0.25rem' }}>
                            <div style={{ color: '#78350f' }}>
                              Action: {summarizeAction(run.latestProposal.action)}
                            </div>
                            <div style={{ color: '#92400e', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                              {run.latestProposal.rationale}
                            </div>
                            {run.latestProposal.confidence !== undefined && (
                              <div style={{ color: '#92400e', fontSize: '0.75rem' }}>
                                Confidence: {Math.round(run.latestProposal.confidence * 100)}%
                              </div>
                            )}
                          </div>
                        )}
                        {run.latestProposal.kind === 'propose_tool' && (
                          <div style={{ marginTop: '0.25rem' }}>
                            <div style={{ color: '#78350f' }}>
                              Tool: {run.latestProposal.toolCall.tool}
                              {run.latestProposal.toolCall.tool.startsWith('fs.') && (
                                <span> → {run.latestProposal.toolCall.path}</span>
                              )}
                              {run.latestProposal.toolCall.tool === 'terminal.exec' && (
                                <span> → {run.latestProposal.toolCall.cmd}</span>
                              )}
                            </div>
                            <div style={{ color: '#92400e', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                              {run.latestProposal.rationale}
                            </div>
                          </div>
                        )}
                        {run.latestProposal.kind === 'ask_user' && (
                          <div style={{ marginTop: '0.25rem', color: '#78350f' }}>
                            ❓ {run.latestProposal.question}
                          </div>
                        )}
                        {run.latestProposal.kind === 'done' && (
                          <div style={{ marginTop: '0.25rem', color: '#166534' }}>
                            ✅ {run.latestProposal.summary}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Iteration 8: Tool Timeline */}
                    {runTools[run.runId] && runTools[run.runId].length > 0 && (
                      <div
                        style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          background: '#f3f4f6',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                        }}
                      >
                        <strong style={{ color: '#374151' }}>🛠️ Tool Timeline:</strong>
                        <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.375rem' }}>
                          {runTools[run.runId].slice(0, 10).map((tool) => (
                            <div
                              key={tool.toolEventId}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.25rem 0.5rem',
                                background: 'white',
                                borderRadius: '4px',
                              }}
                            >
                              <span
                                style={{
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  backgroundColor:
                                    tool.status === 'executed'
                                      ? '#10b981'
                                      : tool.status === 'failed'
                                      ? '#ef4444'
                                      : '#f59e0b',
                                }}
                              />
                              <span style={{ flex: 1 }}>
                                {tool.tool}
                                {tool.pathRel && <span style={{ color: '#6b7280' }}> → {tool.pathRel}</span>}
                                {tool.cmd && <span style={{ color: '#6b7280' }}> → {tool.cmd}</span>}
                              </span>
                              <span
                                style={{
                                  padding: '0.125rem 0.375rem',
                                  backgroundColor: `${
                                    tool.status === 'executed'
                                      ? '#10b981'
                                      : tool.status === 'failed'
                                      ? '#ef4444'
                                      : '#f59e0b'
                                  }20`,
                                  color:
                                    tool.status === 'executed'
                                      ? '#10b981'
                                      : tool.status === 'failed'
                                      ? '#ef4444'
                                      : '#f59e0b',
                                  borderRadius: '4px',
                                  fontSize: '0.625rem',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {tool.status}
                              </span>
                              {tool.exitCode !== undefined && (
                                <span style={{ color: '#6b7280' }}>exit:{tool.exitCode}</span>
                              )}
                              {tool.errorCode && (
                                <span style={{ color: '#ef4444' }}>err:{tool.errorCode}</span>
                              )}
                            </div>
                          ))}
                          {runTools[run.runId].length > 10 && (
                            <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.625rem' }}>
                              +{runTools[run.runId].length - 10} more tools
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {run.steps.length > 0 && (
                      <div style={{ marginTop: '0.75rem' }}>
                        <div
                          style={{
                            height: '4px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '2px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              backgroundColor:
                                run.status === 'done'
                                  ? '#10b981'
                                  : run.status === 'failed' || run.status === 'canceled'
                                  ? '#ef4444'
                                  : '#3b82f6',
                              width: `${(getCompletedStepsCount(run) / run.steps.length) * 100}%`,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {run.reason && (
                      <div
                        style={{
                          marginTop: '0.75rem',
                          padding: '0.5rem',
                          backgroundColor: run.status === 'canceled' ? '#f3f4f6' : '#fee2e2',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          color: run.status === 'canceled' ? '#374151' : '#dc2626',
                        }}
                      >
                        {run.reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {selectedRunId && (
            <section style={{ marginTop: '2rem' }}>
              <h2>Tools</h2>
              <div
                style={{
                  padding: '1rem',
                  background: 'white',
                  borderRadius: '8px',
                  border: '1px solid #e0e0e0',
                }}
              >
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: '#6b7280' }}>
                  Run: {selectedRunId.slice(0, 8)}...
                </p>
                {runTools[selectedRunId]?.length ? (
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {runTools[selectedRunId].map((tool) => (
                      <div
                        key={tool.toolEventId}
                        style={{
                          padding: '0.75rem',
                          borderRadius: '6px',
                          background: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <span style={{ fontWeight: 600 }}>
                            {tool.tool}
                            {tool.pathRel && <span style={{ color: '#6b7280' }}> • {tool.pathRel}</span>}
                            {tool.cmd && <span style={{ color: '#6b7280' }}> • {tool.cmd}</span>}
                          </span>
                          <StatusBadge
                            label={tool.status}
                            color={
                              tool.status === 'executed'
                                ? '#10b981'
                                : tool.status === 'failed'
                                ? '#ef4444'
                                : tool.status === 'denied'
                                ? '#6b7280'
                                : '#f59e0b'
                            }
                          />
                        </div>
                        <div style={{ marginTop: '0.375rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: '#6b7280' }}>
                          <span>{formatTime(tool.at)}</span>
                          {tool.exitCode !== undefined && <span>exit:{tool.exitCode}</span>}
                          {tool.truncated !== undefined && <span>truncated:{tool.truncated ? 'yes' : 'no'}</span>}
                          {tool.errorCode && <span style={{ color: '#dc2626' }}>err:{tool.errorCode}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                    No tool events yet for this run.
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Screen Preview Panel */}
        {previewDeviceId && (
          <div
            style={{
              position: 'sticky',
              top: '2rem',
              height: 'fit-content',
              background: 'white',
              borderRadius: '8px',
              border: '1px solid #e0e0e0',
              padding: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Live Preview</h3>
              <button
                onClick={() => setPreviewDeviceId(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  color: '#666',
                }}
              >
                ×
              </button>
            </div>

            {previewDevice?.screenStreamState?.enabled ? (
              <div>
                <img
                  src={buildApiUrl(`/devices/${previewDeviceId}/screen.png?ts=${screenTimestamp}`, {
                    includeAccessTokenQuery: true,
                  })}
                  alt="Screen preview"
                  onClick={hasActiveSubscription ? handleImageClick : undefined}
                  onWheel={hasActiveSubscription ? handleWheel : undefined}
                  title="Click to send action, scroll to scroll"
                  style={{
                    width: '100%',
                    borderRadius: '4px',
                    border: '1px solid #e0e0e0',
                    cursor: previewDevice?.controlState?.enabled && hasActiveSubscription ? 'crosshair' : 'not-allowed',
                  }}
                />
                
                {/* Control Panel */}
                {previewDevice?.controlState?.enabled ? (
                  <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0fdf4', borderRadius: '4px', border: '1px solid #86efac' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#166534', marginBottom: '0.75rem' }}>
                      🎮 Remote Control Active
                    </div>
                    {!hasActiveSubscription && (
                      <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#9a3412' }}>
                        Subscription required for remote control actions. <Link href="/billing">Upgrade in Billing</Link>.
                      </div>
                    )}
                    
                    {/* Type Input */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <input
                        type="text"
                        value={typeText}
                        onChange={(e) => setTypeText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && hasActiveSubscription) {
                            handleTypeSubmit();
                          }
                        }}
                        placeholder="Type text..."
                        maxLength={500}
                        disabled={!hasActiveSubscription}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: '1px solid #d1d5db',
                          fontSize: '0.875rem',
                        }}
                      />
                      <button
                        onClick={handleTypeSubmit}
                        disabled={!hasActiveSubscription || !typeText.trim()}
                        style={{
                          padding: '0.5rem 1rem',
                          borderRadius: '4px',
                          border: 'none',
                          background: hasActiveSubscription && typeText.trim() ? '#16a34a' : '#9ca3af',
                          color: 'white',
                          cursor: hasActiveSubscription && typeText.trim() ? 'pointer' : 'not-allowed',
                          fontSize: '0.875rem',
                        }}
                      >
                        Type
                      </button>
                    </div>

                    {/* Hotkey Buttons */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <button onClick={() => handleHotkey('return')} style={hotkeyBtnStyle} disabled={!hasActiveSubscription}>Enter</button>
                      <button onClick={() => handleHotkey('tab')} style={hotkeyBtnStyle} disabled={!hasActiveSubscription}>Tab</button>
                      <button onClick={() => handleHotkey('escape')} style={hotkeyBtnStyle} disabled={!hasActiveSubscription}>Esc</button>
                      <button onClick={() => handleHotkey('up')} style={hotkeyBtnStyle} disabled={!hasActiveSubscription}>↑</button>
                      <button onClick={() => handleHotkey('down')} style={hotkeyBtnStyle} disabled={!hasActiveSubscription}>↓</button>
                      <button onClick={() => handleHotkey('left')} style={hotkeyBtnStyle} disabled={!hasActiveSubscription}>←</button>
                      <button onClick={() => handleHotkey('right')} style={hotkeyBtnStyle} disabled={!hasActiveSubscription}>→</button>
                    </div>

                    {/* Actions Log */}
                    {actions.length > 0 && (
                      <div style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
                        <div style={{ color: '#6b7280', marginBottom: '0.25rem' }}>Recent Actions:</div>
                        <div style={{ maxHeight: '100px', overflow: 'auto' }}>
                          {actions.slice(-5).map((a) => (
                            <div key={a.actionId} style={{ display: 'flex', gap: '0.5rem', color: '#374151' }}>
                              <span style={{ textTransform: 'capitalize' }}>{a.action.kind}</span>
                              <span style={{ color: '#9ca3af' }}>→</span>
                              <span style={{ 
                                color: a.status === 'executed' ? '#16a34a' : 
                                       a.status === 'failed' ? '#dc2626' : 
                                       a.status === 'denied' ? '#7f1d1d' : '#d97706'
                              }}>
                                {a.status}
                              </span>
                              {a.source && (
                                <span style={{ color: '#9ca3af' }}>({a.source})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fef3c7', borderRadius: '4px', border: '1px solid #fcd34d', fontSize: '0.875rem', color: '#92400e' }}>
                    🔒 Remote control is disabled. Ask user to enable &quot;Allow Control&quot; on the desktop app.
                  </div>
                )}
                
                {screenMeta && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#666' }}>
                    <div>Resolution: {screenMeta.width}×{screenMeta.height}</div>
                    <div>Size: {(screenMeta.byteLength / 1024).toFixed(1)} KB</div>
                    <div>Updated: {formatTime(screenMeta.at)}</div>
                  </div>
                )}

                <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                  Updates in real-time via SSE
                </p>
              </div>
            ) : (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  background: '#f9fafb',
                  borderRadius: '4px',
                  color: '#6b7280',
                }}
              >
                <p>Screen preview is not enabled.</p>
                <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  Ask the user to enable &quot;Share Screen Preview&quot; in the desktop overlay.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 500,
        backgroundColor: `${color}20`,
        color,
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: color,
        }}
      />
      {label}
    </span>
  );
}
