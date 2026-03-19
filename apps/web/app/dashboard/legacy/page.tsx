'use client';

import { useCallback, useEffect, useState, type MouseEvent, type WheelEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CreditCard,
  Eye,
  Keyboard,
  Loader2,
  LogOut,
  Monitor,
  MousePointer2,
  Play,
  RefreshCcw,
  Server,
  Square,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import {
  apiFetch,
  buildApiUrl,
  getBillingStatus,
  getMe,
  getSessions,
  logout,
  logoutAllSessions,
  type BillingStatus,
  type BrowserSession,
} from '../../../lib/auth';
import { Badge, Banner, Button, Card, FieldLabel, Select, TextArea, TextInput } from '../../../components/ui';

interface Device {
  deviceId: string;
  deviceName?: string;
  platform: string;
  connected: boolean;
  paired: boolean;
  pairingCode?: string;
  pairingExpiresAt?: number | string;
  lastSeenAt: number | string;
  screenStreamState?: {
    enabled: boolean;
    fps: 1 | 2;
    displayId?: string;
  };
  controlState?: {
    enabled: boolean;
    updatedAt: number | string;
    requestedBy?: string;
  };
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
  createdAt: number | string;
  updatedAt: number | string;
  reason?: string;
  steps: RunStep[];
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

function formatDateTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return 'Unknown';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString();
}

function formatClockTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return '--:--:--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  return date.toLocaleTimeString();
}

function getTimeRemaining(expiresAt: number | string | undefined): string {
  if (!expiresAt) {
    return '0:00';
  }

  const expiry = typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  const remaining = Math.max(0, expiry - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getDeviceName(device: Device): string {
  return device.deviceName?.trim() || `Desktop-${device.deviceId.slice(0, 8)}`;
}

function getStatusTone(status: string): 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'connected' || status === 'paired' || status === 'done' || status === 'executed' || status === 'active') {
    return 'success';
  }

  if (status === 'failed' || status === 'canceled' || status === 'denied') {
    return 'danger';
  }

  if (status === 'offline' || status === 'unpaired' || status === 'queued' || status === 'requested' || status === 'awaiting_user') {
    return 'warning';
  }

  return 'info';
}

function summarizeAction(action: DeviceAction['action']): string {
  switch (action.kind) {
    case 'type': {
      const text = typeof action.text === 'string' ? action.text : '';
      return `Type "${text.slice(0, 28)}${text.length > 28 ? '…' : ''}"`;
    }
    case 'click':
      return `Click at ${Math.round(((action.x as number) || 0) * 100)}%, ${Math.round(((action.y as number) || 0) * 100)}%`;
    case 'double_click':
      return 'Double-click';
    case 'scroll':
      return 'Scroll';
    case 'hotkey':
      return `Hotkey ${(action.key as string) || 'unknown'}`;
    default:
      return action.kind;
  }
}

function getCompletedStepsCount(run: Run): number {
  return (run.steps || []).filter((step) => step.status === 'done').length;
}

function renderLatestProposal(proposal: AgentProposal) {
  switch (proposal.kind) {
    case 'propose_action':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <p className="small-note" style={{ color: '#fde68a' }}>
            Action: {summarizeAction({ actionId: '', deviceId: '', action: proposal.action, status: 'requested', createdAt: 0, updatedAt: 0 }.action)}
          </p>
          <p className="small-note">{proposal.rationale}</p>
          {proposal.confidence !== undefined ? (
            <p className="small-note mono">Confidence: {Math.round(proposal.confidence * 100)}%</p>
          ) : null}
        </div>
      );
    case 'propose_tool':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <p className="small-note" style={{ color: '#fde68a' }}>
            Tool: {proposal.toolCall.tool}
            {proposal.toolCall.path ? ` → ${proposal.toolCall.path}` : ''}
            {proposal.toolCall.cmd ? ` → ${proposal.toolCall.cmd}` : ''}
          </p>
          <p className="small-note">{proposal.rationale}</p>
        </div>
      );
    case 'ask_user':
      return <p className="small-note">Question: {proposal.question}</p>;
    case 'done':
      return <p className="small-note">Summary: {proposal.summary}</p>;
    default:
      return null;
  }
}

export default function LegacyDashboardPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [pairingInputs, setPairingInputs] = useState<Record<string, string>>({});
  const [pairingLoading, setPairingLoading] = useState<Record<string, boolean>>({});
  const [manualPairDeviceId, setManualPairDeviceId] = useState('');
  const [manualPairCode, setManualPairCode] = useState('');
  const [manualPairLoading, setManualPairLoading] = useState(false);
  const [newRunGoal, setNewRunGoal] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedRunMode, setSelectedRunMode] = useState<'manual' | 'ai_assist'>('manual');
  const [previewDeviceId, setPreviewDeviceId] = useState<string | null>(null);
  const [screenMeta, setScreenMeta] = useState<ScreenFrameMeta | null>(null);
  const [screenTimestamp, setScreenTimestamp] = useState<number>(0);
  const [actions, setActions] = useState<DeviceAction[]>([]);
  const [typeText, setTypeText] = useState('');
  const [runTools, setRunTools] = useState<Record<string, ToolSummary[]>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [telemetry, setTelemetry] = useState<string[]>([]);

  const appendTelemetry = useCallback((message: string) => {
    setTelemetry((prev) => [`[${formatClockTime(Date.now())}] ${message}`, ...prev].slice(0, 40));
  }, []);

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
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load session');
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const fetchInitialData = useCallback(async () => {
    if (!authReady) {
      return;
    }

    try {
      setError(null);

      const devicesResponse = await apiFetch('/devices');
      if (devicesResponse.status === 401) {
        router.replace('/login');
        return;
      }
      const devicesPayload = await devicesResponse.json().catch(() => ({ error: 'Failed to fetch devices' }));
      if (!devicesResponse.ok) {
        throw new Error(devicesPayload.error || 'Failed to fetch devices');
      }

      const runsResponse = await apiFetch('/runs');
      if (runsResponse.status === 401) {
        router.replace('/login');
        return;
      }
      const runsPayload = await runsResponse.json().catch(() => ({ error: 'Failed to fetch runs' }));
      if (!runsResponse.ok) {
        throw new Error(runsPayload.error || 'Failed to fetch runs');
      }

      const [sessionsData, billingStatus] = await Promise.all([getSessions(), getBillingStatus()]);

      setDevices((devicesPayload.devices || []) as Device[]);
      setRuns((runsPayload.runs || []) as Run[]);
      setSessions(sessionsData);
      setBilling(billingStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [authReady, router]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    void fetchInitialData();

    const setupSSE = () => {
      let opened = false;
      const eventSource = new EventSource(buildApiUrl('/events', { includeAccessTokenQuery: true }), {
        withCredentials: true,
      });

      eventSource.onopen = () => {
        opened = true;
        setSseConnected(true);
        appendTelemetry('LIVE_UPDATES connected');
      };

      eventSource.onmessage = (event) => {
        try {
          const data: SSEEvent = JSON.parse(event.data);

          switch (data.type) {
            case 'run_update':
              if (data.run) {
                setRuns((prev) => {
                  const existing = prev.find((run) => run.runId === data.run!.runId);
                  if (existing) {
                    return prev.map((run) => (run.runId === data.run!.runId ? data.run! : run));
                  }
                  return [data.run!, ...prev];
                });
                appendTelemetry(`RUN ${data.run.runId.slice(0, 8)} ${data.run.status}`);
              }
              break;

            case 'step_update':
              if (data.runId && data.step) {
                setRuns((prev) =>
                  prev.map((run) =>
                    run.runId === data.runId
                      ? {
                          ...run,
                          steps: (run.steps || []).map((step) => (step.stepId === data.step!.stepId ? data.step! : step)),
                        }
                      : run
                  )
                );
                appendTelemetry(`STEP ${data.step.stepId.slice(0, 8)} ${data.step.status}`);
              }
              break;

            case 'screen_update':
              if (data.deviceId && data.meta) {
                setScreenMeta(data.meta);
                setScreenTimestamp(Date.now());
                appendTelemetry(`SCREEN ${data.deviceId.slice(0, 8)} updated`);
              }
              break;

            case 'action_update':
              if (data.action) {
                setActions((prev) => {
                  const existing = prev.find((action) => action.actionId === data.action!.actionId);
                  if (existing) {
                    return prev.map((action) => (action.actionId === data.action!.actionId ? data.action! : action));
                  }
                  return [data.action!, ...prev].slice(0, 20);
                });
                appendTelemetry(`ACTION ${data.action.action.kind} ${data.action.status}`);
              }
              break;

            case 'tool_update':
              if (data.tool?.runId) {
                setRunTools((prev) => {
                  const runId = data.tool!.runId!;
                  const existing = prev[runId]?.find((tool) => tool.toolEventId === data.tool!.toolEventId);
                  if (existing) {
                    return {
                      ...prev,
                      [runId]: prev[runId].map((tool) => (tool.toolEventId === data.tool!.toolEventId ? data.tool! : tool)),
                    };
                  }

                  return {
                    ...prev,
                    [runId]: [data.tool!, ...(prev[runId] || [])].slice(0, 50),
                  };
                });
                appendTelemetry(`TOOL ${data.tool.tool} ${data.tool.status}`);
              }
              break;

            case 'log_line':
              if (data.log?.line) {
                appendTelemetry(data.log.line);
              }
              break;

            case 'device_update':
              if (data.deviceId) {
                appendTelemetry(`DEVICE ${data.deviceId.slice(0, 8)} updated`);
              }
              break;

            case 'connected':
              appendTelemetry('LIVE_UPDATES ready');
              break;
          }
        } catch {
          appendTelemetry('LIVE_UPDATES parse_error');
        }
      };

      eventSource.onerror = () => {
        setSseConnected(false);
        appendTelemetry('LIVE_UPDATES disconnected');

        if (!opened) {
          setError('Please log in again');
          eventSource.close();
          return;
        }

        setTimeout(() => {
          if (eventSource.readyState === EventSource.CLOSED) {
            setupSSE();
          }
        }, 3_000);
      };

      return eventSource;
    };

    const eventSource = setupSSE();

    const interval = setInterval(async () => {
      try {
        const response = await apiFetch('/devices');
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        setDevices((payload.devices || []) as Device[]);
      } catch {
        appendTelemetry('DEVICE poll_failed');
      }
    }, 3_000);

    return () => {
      clearInterval(interval);
      eventSource.close();
    };
  }, [appendTelemetry, authReady, fetchInitialData]);

  useEffect(() => {
    if (devices.length === 0) {
      if (selectedDeviceId) {
        setSelectedDeviceId('');
      }
      if (previewDeviceId) {
        setPreviewDeviceId(null);
      }
      return;
    }

    const selectedExists = devices.some((device) => device.deviceId === selectedDeviceId);
    if (!selectedExists) {
      setSelectedDeviceId(devices[0].deviceId);
    }

    if (previewDeviceId && !devices.some((device) => device.deviceId === previewDeviceId)) {
      setPreviewDeviceId(null);
    }
  }, [devices, previewDeviceId, selectedDeviceId]);

  const submitPairing = async (deviceId: string, pairingCode: string) => {
    const response = await apiFetch(`/devices/${deviceId}/pair`, {
      method: 'POST',
      body: JSON.stringify({ pairingCode }),
    });

    const payload = await response.json().catch(() => ({ error: 'Pairing failed' }));
    if (!response.ok) {
      throw new Error(payload.error || 'Pairing failed');
    }

    const devicesResponse = await apiFetch('/devices');
    if (devicesResponse.ok) {
      const devicesPayload = await devicesResponse.json();
      setDevices((devicesPayload.devices || []) as Device[]);
    }
  };

  const handlePairSubmit = async (deviceId: string) => {
    const code = pairingInputs[deviceId]?.trim().toUpperCase();
    if (!code) {
      return;
    }

    setPairingLoading((prev) => ({ ...prev, [deviceId]: true }));

    try {
      await submitPairing(deviceId, code);
      setPairingInputs((prev) => ({ ...prev, [deviceId]: '' }));
      appendTelemetry(`PAIR ${deviceId.slice(0, 8)} submitted`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setPairingLoading((prev) => ({ ...prev, [deviceId]: false }));
    }
  };

  const handleManualPairSubmit = async () => {
    const deviceId = manualPairDeviceId.trim();
    const code = manualPairCode.trim().toUpperCase();
    if (!deviceId || !code) {
      return;
    }

    setManualPairLoading(true);

    try {
      await submitPairing(deviceId, code);
      setManualPairDeviceId('');
      setManualPairCode('');
      appendTelemetry(`PAIR ${deviceId.slice(0, 8)} submitted`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setManualPairLoading(false);
    }
  };

  const handleCreateRun = async () => {
    if (billing?.subscriptionStatus !== 'active') {
      window.alert('An active subscription is required to create runs.');
      return;
    }

    if (!selectedDeviceId || !newRunGoal.trim()) {
      return;
    }

    try {
      const response = await apiFetch('/runs', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: selectedDeviceId,
          goal: newRunGoal.trim(),
          mode: selectedRunMode,
        }),
      });

      const payload = await response.json().catch(() => ({ error: 'Failed to create run' }));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to create run');
      }

      setNewRunGoal('');
      appendTelemetry(`RUN ${selectedRunMode} created`);

      const runsResponse = await apiFetch('/runs');
      if (runsResponse.ok) {
        const runsPayload = await runsResponse.json();
        setRuns((runsPayload.runs || []) as Run[]);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to create run');
    }
  };

  const handleCancelRun = async (runId: string) => {
    try {
      const response = await apiFetch(`/runs/${runId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Canceled from dashboard' }),
      });

      const payload = await response.json().catch(() => ({ error: 'Failed to cancel run' }));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to cancel run');
      }

      appendTelemetry(`RUN ${runId.slice(0, 8)} canceled`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to cancel run');
    }
  };

  const handleSelectRunTools = async (runId: string) => {
    setSelectedRunId(runId);

    try {
      const response = await apiFetch(`/runs/${runId}/tools`);
      const payload = await response.json().catch(() => ({ error: 'Failed to fetch tool timeline' }));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to fetch tool timeline');
      }

      setRunTools((prev) => ({
        ...prev,
        [runId]: (payload.tools || []) as ToolSummary[],
      }));
      appendTelemetry(`TOOLS ${runId.slice(0, 8)} loaded`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to fetch tool timeline');
    }
  };

  const handleLogoutAll = async () => {
    try {
      await logoutAllSessions();
      router.push('/login');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to log out all sessions');
    }
  };

  const sendAction = async (action: DeviceAction['action']) => {
    if (billing?.subscriptionStatus !== 'active') {
      window.alert('An active subscription is required for remote control.');
      return;
    }

    if (!previewDeviceId) {
      return;
    }

    try {
      const response = await apiFetch(`/devices/${previewDeviceId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });

      const payload = await response.json().catch(() => ({ error: 'Failed to send action' }));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send action');
      }

      appendTelemetry(`ACTION ${action.kind} sent`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to send action');
    }
  };

  const handleImageClick = (event: MouseEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const rect = image.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    void sendAction({ kind: 'click', x, y, button: 'left' });
  };

  const handleTypeSubmit = () => {
    if (!typeText.trim()) {
      return;
    }
    void sendAction({ kind: 'type', text: typeText });
    setTypeText('');
  };

  const handleHotkey = (key: string, modifiers?: string[]) => {
    void sendAction({ kind: 'hotkey', key, modifiers });
  };

  const handleWheel = (event: WheelEvent<HTMLImageElement>) => {
    event.preventDefault();
    void sendAction({ kind: 'scroll', dx: event.deltaX, dy: event.deltaY });
  };

  const pairedDevices = devices.filter((device) => device.paired);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId) || null;
  const previewDevice = previewDeviceId ? devices.find((device) => device.deviceId === previewDeviceId) || null : null;
  const hasActiveSubscription = billing?.subscriptionStatus === 'active';
  const previewCanControl = Boolean(previewDevice?.controlState?.enabled && hasActiveSubscription);
  const visibleRuns = runs
    .filter((run) => (selectedDevice ? run.deviceId === selectedDevice.deviceId : true))
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (loading) {
    return (
      <main className="page--wide">
        <Card>
          <div className="banner">
            <Loader2 size={16} className="spinner" />
            Loading legacy tools...
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="page--wide">
      <Card subtle>
        <div className="split">
          <div className="stack" style={{ gap: 14 }}>
            <div className="row-actions">
              <Link href="/" className="button button--ghost">
                <ArrowLeft size={16} />
                Back Home
              </Link>
              <Link href="/dashboard" className="button button--secondary">
                Main Dashboard
              </Link>
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <Badge>
                <Terminal size={14} />
                Admin / Legacy Tools
              </Badge>
              <h1 className="section-heading" style={{ fontSize: 'clamp(2rem, 4vw, 3.2rem)' }}>
                Admin / Legacy Tools
              </h1>
              <p className="copy" style={{ maxWidth: 780 }}>
                Migration fallback for debug access, older desktop builds, and legacy browser-driven controls.
                This is the older browser surface for pairing, Create Run, screen preview, remote control, and
                tool inspection.
              </p>
            </div>
          </div>

          <div className="stack" style={{ gap: 12, minWidth: 280 }}>
            <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
              <Badge tone={sseConnected ? 'success' : 'warning'}>
                <Activity size={14} />
                {sseConnected ? 'Live Updates' : 'Reconnecting...'}
              </Badge>
            </div>
            {userEmail ? <p className="small-note mono" style={{ textAlign: 'right' }}>{userEmail}</p> : null}
            <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
              <Button
                variant="ghost"
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
          </div>
        </div>
      </Card>

      {error ? (
        <div style={{ marginTop: 20 }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : null}

      {!hasActiveSubscription ? (
        <div style={{ marginTop: 20 }}>
          <Banner tone="warning">
            <AlertCircle size={16} />
            Remote execution requires an active subscription. Visit <Link href="/billing">/billing</Link> to
            unlock browser-driven run creation and remote control.
          </Banner>
        </div>
      ) : null}

      <section className="legacy-layout" style={{ marginTop: 24 }}>
        <div className="legacy-sidebar">
          <Card>
            <div className="stack" style={{ gap: 14 }}>
              <div className="split">
                <div>
                  <p className="section-title" style={{ marginBottom: 0 }}>
                    Nodes
                  </p>
                  <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                    Device Fleet
                  </h2>
                </div>
                <Server size={20} color="rgba(255,255,255,0.44)" />
              </div>

              {devices.length === 0 ? (
                <div className="empty-state">No connected devices yet.</div>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {devices.map((device) => {
                    const active = selectedDeviceId === device.deviceId;

                    return (
                      <button
                        key={device.deviceId}
                        type="button"
                        onClick={() => setSelectedDeviceId(device.deviceId)}
                        className="device-row"
                        style={{
                          textAlign: 'left',
                          borderColor: active ? 'rgba(255,255,255,0.2)' : undefined,
                          background: active ? 'rgba(255,255,255,0.06)' : undefined,
                          padding: 14,
                        }}
                      >
                        <div className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <p className="device-name" style={{ fontSize: 14 }}>
                            {getDeviceName(device)}
                          </p>
                          <Badge tone={device.connected ? 'success' : 'warning'}>
                            {device.connected ? 'Online' : 'Offline'}
                          </Badge>
                        </div>
                        <p className="small-note mono" style={{ marginTop: 8 }}>
                          {device.platform} • {device.deviceId.slice(0, 10)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="stack" style={{ gap: 16 }}>
              <div className="split">
                <div>
                  <p className="section-title" style={{ marginBottom: 0 }}>
                    Pair a desktop device
                  </p>
                  <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                    Pair a desktop device
                  </h2>
                </div>
                <Zap size={20} color="rgba(255,255,255,0.44)" />
              </div>
              <p className="copy">
                If the desktop app shows a pairing code but has not appeared in the list yet, enter its device ID
                and pairing code here.
              </p>
              <div>
                <FieldLabel htmlFor="manual-device-id">Device ID</FieldLabel>
                <TextInput
                  id="manual-device-id"
                  placeholder="Enter device ID"
                  value={manualPairDeviceId}
                  onChange={(event) => setManualPairDeviceId(event.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="manual-pairing-code">Pairing code</FieldLabel>
                <TextInput
                  id="manual-pairing-code"
                  placeholder="Enter pairing code"
                  value={manualPairCode}
                  onChange={(event) => setManualPairCode(event.target.value.toUpperCase())}
                />
              </div>
              <Button
                onClick={() => {
                  void handleManualPairSubmit();
                }}
                loading={manualPairLoading}
                disabled={!manualPairDeviceId.trim() || !manualPairCode.trim()}
              >
                Pair Device
              </Button>
            </div>
          </Card>

          <Card>
            <div className="stack" style={{ gap: 16 }}>
              <div className="split">
                <div>
                  <p className="section-title" style={{ marginBottom: 0 }}>
                    Sessions
                  </p>
                  <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                    Sessions
                  </h2>
                </div>
                <RefreshCcw size={20} color="rgba(255,255,255,0.44)" />
              </div>

              <Button variant="danger" onClick={() => void handleLogoutAll()}>
                Logout All Sessions
              </Button>

              {sessions.length === 0 ? (
                <div className="empty-state">No active sessions found.</div>
              ) : (
                <div className="session-list">
                  {sessions.map((session) => (
                    <div key={session.id} className="session-row">
                      <p className="small-note mono">ID: {session.id}</p>
                      <p className="small-note">Created: {formatDateTime(session.createdAt)}</p>
                      <p className="small-note">Last used: {formatDateTime(session.lastUsedAt)}</p>
                      <p className="small-note">Expires: {formatDateTime(session.expiresAt)}</p>
                      {session.revokedAt ? <p className="small-note">Revoked: {formatDateTime(session.revokedAt)}</p> : null}
                      {session.userAgent ? <p className="small-note">{session.userAgent}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="legacy-main">
          <Card>
            <div className="split">
              <div className="stack" style={{ gap: 12 }}>
                <div className="row-actions" style={{ alignItems: 'center', gap: 10 }}>
                  <Badge tone={selectedDevice?.connected ? 'success' : 'warning'}>
                    {selectedDevice?.connected ? 'Connected' : 'Offline'}
                  </Badge>
                  <Badge tone={selectedDevice?.paired ? 'success' : 'warning'}>
                    {selectedDevice?.paired ? 'Paired' : 'Unpaired'}
                  </Badge>
                </div>
                <h2 className="section-heading">{selectedDevice ? getDeviceName(selectedDevice) : 'Select a device'}</h2>
                <p className="copy">
                  {selectedDevice
                    ? `${selectedDevice.platform} • ${selectedDevice.deviceId} • Last seen ${formatDateTime(selectedDevice.lastSeenAt)}`
                    : 'Choose a device from the left rail to inspect live state, preview, and remote controls.'}
                </p>
              </div>

              <div className="stack" style={{ gap: 10, minWidth: 220 }}>
                {selectedDevice?.workspaceState?.configured ? (
                  <Badge tone="success">Workspace: {selectedDevice.workspaceState.rootName || 'Configured'}</Badge>
                ) : (
                  <Badge tone="warning">Workspace: Not configured</Badge>
                )}
                {selectedDevice?.paired && selectedDevice.screenStreamState?.enabled ? (
                  <Button
                    variant={previewDeviceId === selectedDevice.deviceId ? 'secondary' : 'primary'}
                    onClick={() => setPreviewDeviceId(previewDeviceId === selectedDevice.deviceId ? null : selectedDevice.deviceId)}
                  >
                    <Eye size={16} />
                    {previewDeviceId === selectedDevice.deviceId ? 'Viewing' : 'View Screen'}
                  </Button>
                ) : null}
              </div>
            </div>

            {!selectedDevice ? (
              <div className="empty-state" style={{ marginTop: 20 }}>
                Select a device to initialize the console view.
              </div>
            ) : !selectedDevice.paired && selectedDevice.pairingCode && selectedDevice.pairingExpiresAt ? (
              <div style={{ marginTop: 20 }}>
                <Banner tone="warning">
                  Pairing code {selectedDevice.pairingCode} expires in {getTimeRemaining(selectedDevice.pairingExpiresAt)}.
                </Banner>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="split">
              <div>
                <p className="section-title" style={{ marginBottom: 0 }}>
                  Live Preview
                </p>
                <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                  Live Preview
                </h2>
              </div>
              {previewDevice ? (
                <Badge tone={previewDevice.screenStreamState?.enabled ? 'success' : 'warning'}>
                  <Monitor size={14} />
                  {previewDevice.screenStreamState?.enabled ? 'Screen active' : 'Screen disabled'}
                </Badge>
              ) : (
                <Badge tone="info">
                  <Eye size={14} />
                  Waiting for selection
                </Badge>
              )}
            </div>

            <div className="screen-frame" style={{ marginTop: 20 }}>
              {previewDevice?.screenStreamState?.enabled ? (
                <>
                  <img
                    src={buildApiUrl(`/devices/${previewDeviceId}/screen.png?ts=${screenTimestamp}`, {
                      includeAccessTokenQuery: true,
                    })}
                    alt="Screen preview"
                    onClick={previewCanControl ? handleImageClick : undefined}
                    onWheel={previewCanControl ? handleWheel : undefined}
                    title="Click to send action, scroll to scroll"
                    style={{ cursor: previewCanControl ? 'crosshair' : 'not-allowed' }}
                  />
                  <div style={{ position: 'absolute', top: 18, right: 18 }}>
                    <Badge tone="info">
                      <MousePointer2 size={14} />
                      {previewCanControl ? 'Control ready' : 'Preview only'}
                    </Badge>
                  </div>
                </>
              ) : (
                <div className="screen-frame__empty">
                  <div className="stack" style={{ gap: 10, textAlign: 'center' }}>
                    <Eye size={22} style={{ margin: '0 auto', opacity: 0.6 }} />
                    <p className="small-note">
                      {previewDevice
                        ? 'Screen preview is not enabled.'
                        : 'Select a paired device with screen sharing enabled to open Live Preview.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {previewDevice ? (
              <div className="control-stack" style={{ marginTop: 18 }}>
                {previewDevice.controlState?.enabled ? (
                  <Card subtle>
                    <div className="stack" style={{ gap: 14 }}>
                      <div className="row-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="row-actions" style={{ alignItems: 'center', gap: 8 }}>
                          <Keyboard size={16} />
                          <p className="section-title" style={{ marginBottom: 0 }}>
                            Remote Control
                          </p>
                        </div>
                        <Badge tone={hasActiveSubscription ? 'success' : 'warning'}>
                          {hasActiveSubscription ? 'Control enabled' : 'Billing required'}
                        </Badge>
                      </div>

                      {!hasActiveSubscription ? (
                        <Banner tone="warning">
                          <CreditCard size={16} />
                          Subscription required for remote control actions. Upgrade in <Link href="/billing">Billing</Link>.
                        </Banner>
                      ) : null}

                      <div className="control-row">
                        <TextInput
                          value={typeText}
                          onChange={(event) => setTypeText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && hasActiveSubscription) {
                              handleTypeSubmit();
                            }
                          }}
                          placeholder="Type text..."
                          maxLength={500}
                          disabled={!hasActiveSubscription}
                        />
                        <Button onClick={handleTypeSubmit} disabled={!hasActiveSubscription || !typeText.trim()}>
                          Type
                        </Button>
                      </div>

                      <div className="control-row">
                        <Button variant="secondary" onClick={() => handleHotkey('return')} disabled={!hasActiveSubscription}>
                          Enter
                        </Button>
                        <Button variant="secondary" onClick={() => handleHotkey('tab')} disabled={!hasActiveSubscription}>
                          Tab
                        </Button>
                        <Button variant="secondary" onClick={() => handleHotkey('escape')} disabled={!hasActiveSubscription}>
                          Esc
                        </Button>
                        <Button variant="secondary" onClick={() => handleHotkey('up')} disabled={!hasActiveSubscription}>
                          <ArrowUp size={16} />
                          ↑
                        </Button>
                        <Button variant="secondary" onClick={() => handleHotkey('down')} disabled={!hasActiveSubscription}>
                          <ArrowDown size={16} />
                          ↓
                        </Button>
                        <Button variant="secondary" onClick={() => handleHotkey('left')} disabled={!hasActiveSubscription}>
                          <ArrowLeft size={16} />
                          ←
                        </Button>
                        <Button variant="secondary" onClick={() => handleHotkey('right')} disabled={!hasActiveSubscription}>
                          <ArrowRight size={16} />
                          →
                        </Button>
                      </div>

                      <div className="stack" style={{ gap: 10 }}>
                        <p className="section-title" style={{ marginBottom: 0 }}>
                          Recent Actions
                        </p>
                        {actions.length === 0 ? (
                          <div className="empty-state">No recent actions yet.</div>
                        ) : (
                          <div className="stack" style={{ gap: 8 }}>
                            {actions.slice(0, 5).map((action) => (
                              <div key={action.actionId} className="tool-row" style={{ padding: 14 }}>
                                <div className="row-actions" style={{ justifyContent: 'space-between', gap: 10 }}>
                                  <p className="small-note">{summarizeAction(action.action)}</p>
                                  <Badge tone={getStatusTone(action.status)}>{action.status}</Badge>
                                </div>
                                <p className="small-note mono" style={{ marginTop: 8 }}>
                                  {formatClockTime(action.updatedAt)}
                                  {action.source ? ` • ${action.source}` : ''}
                                  {action.runId ? ` • ${action.runId.slice(0, 8)}` : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ) : (
                  <Banner tone="warning" style={{ marginTop: 4 }}>
                    Remote control is disabled. Ask the user to enable Allow Control on the desktop app.
                  </Banner>
                )}

                {screenMeta ? (
                  <div className="row-actions" style={{ gap: 18, alignItems: 'center' }}>
                    <p className="small-note mono">Resolution: {screenMeta.width}×{screenMeta.height}</p>
                    <p className="small-note mono">Size: {(screenMeta.byteLength / 1024).toFixed(1)} KB</p>
                    <p className="small-note mono">Updated: {formatClockTime(screenMeta.at)}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="split">
              <div>
                <p className="section-title" style={{ marginBottom: 0 }}>
                  Devices
                </p>
                <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                  Devices
                </h2>
              </div>
              <Button variant="secondary" onClick={() => void fetchInitialData()}>
                <RefreshCcw size={16} />
                Refresh
              </Button>
            </div>

            {devices.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 20 }}>
                No devices connected.
              </div>
            ) : (
              <div className="device-list" style={{ marginTop: 20 }}>
                {devices.map((device) => (
                  <div key={device.deviceId} className="device-row">
                    <div className="device-row__header">
                      <div className="stack" style={{ gap: 8 }}>
                        <div className="row-actions" style={{ alignItems: 'center', gap: 10 }}>
                          <p className="device-name">{getDeviceName(device)}</p>
                          <Badge tone={device.connected ? 'success' : 'warning'}>
                            {device.connected ? 'Connected' : 'Offline'}
                          </Badge>
                          <Badge tone={device.paired ? 'success' : 'warning'}>
                            {device.paired ? 'Paired' : 'Unpaired'}
                          </Badge>
                        </div>
                        <p className="device-meta mono">
                          {device.deviceId} • {device.platform} • Last seen {formatDateTime(device.lastSeenAt)}
                        </p>
                        <p className="device-meta">
                          Workspace: {device.workspaceState?.configured ? device.workspaceState.rootName || 'Configured' : 'Not configured'}
                        </p>
                        {device.screenStreamState?.enabled ? (
                          <p className="device-meta">Screen sharing enabled at {device.screenStreamState.fps} FPS.</p>
                        ) : null}
                      </div>

                      <div className="stack" style={{ gap: 10, minWidth: 180 }}>
                        {device.paired && device.screenStreamState?.enabled ? (
                          <Button
                            variant={previewDeviceId === device.deviceId ? 'secondary' : 'primary'}
                            onClick={() => setPreviewDeviceId(previewDeviceId === device.deviceId ? null : device.deviceId)}
                          >
                            <Eye size={16} />
                            {previewDeviceId === device.deviceId ? 'Viewing' : 'View Screen'}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {!device.paired && device.pairingCode && device.pairingExpiresAt ? (
                      <div style={{ marginTop: 18 }}>
                        <Banner tone="warning">
                          Pairing Code: {device.pairingCode} (expires in {getTimeRemaining(device.pairingExpiresAt)})
                        </Banner>
                      </div>
                    ) : null}

                    {!device.paired ? (
                      <div className="control-row" style={{ marginTop: 18 }}>
                        <TextInput
                          placeholder="Enter pairing code"
                          value={pairingInputs[device.deviceId] || ''}
                          onChange={(event) =>
                            setPairingInputs((prev) => ({
                              ...prev,
                              [device.deviceId]: event.target.value.toUpperCase(),
                            }))
                          }
                        />
                        <Button
                          onClick={() => void handlePairSubmit(device.deviceId)}
                          loading={Boolean(pairingLoading[device.deviceId])}
                          disabled={!pairingInputs[device.deviceId]?.trim()}
                        >
                          Pair
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="legacy-rail">
          <Card>
            <div className="stack" style={{ gap: 16 }}>
              <div className="split">
                <div>
                  <p className="section-title" style={{ marginBottom: 0 }}>
                    Create Run
                  </p>
                  <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                    Create Run
                  </h2>
                </div>
                <Play size={20} color="rgba(255,255,255,0.44)" />
              </div>

              {pairedDevices.length === 0 ? (
                <div className="empty-state">Pair a desktop before creating a run.</div>
              ) : (
                <>
                  <div>
                    <FieldLabel htmlFor="run-device">Device</FieldLabel>
                    <Select
                      id="run-device"
                      value={selectedDeviceId}
                      onChange={(event) => setSelectedDeviceId(event.target.value)}
                      disabled={!hasActiveSubscription}
                    >
                      <option value="">Select device</option>
                      {pairedDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {getDeviceName(device)}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <FieldLabel htmlFor="run-mode">Mode</FieldLabel>
                    <Select
                      id="run-mode"
                      value={selectedRunMode}
                      onChange={(event) => setSelectedRunMode(event.target.value as 'manual' | 'ai_assist')}
                      disabled={!hasActiveSubscription}
                    >
                      <option value="manual">manual</option>
                      <option value="ai_assist">ai_assist</option>
                    </Select>
                  </div>

                  <div>
                    <FieldLabel htmlFor="run-goal">Goal</FieldLabel>
                    <TextArea
                      id="run-goal"
                      placeholder="Define target objective..."
                      value={newRunGoal}
                      onChange={(event) => setNewRunGoal(event.target.value)}
                      disabled={!hasActiveSubscription}
                    />
                  </div>

                  {selectedRunMode === 'ai_assist' ? (
                    <p className="small-note">
                      AI Assist proposes actions and tools one step at a time. Every privileged step still requires
                      explicit desktop approval.
                    </p>
                  ) : null}

                  <Button
                    onClick={() => void handleCreateRun()}
                    disabled={!hasActiveSubscription || !selectedDeviceId || !newRunGoal.trim()}
                  >
                    <Play size={16} />
                    Create Run
                  </Button>
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="stack" style={{ gap: 16 }}>
              <div className="split">
                <div>
                  <p className="section-title" style={{ marginBottom: 0 }}>
                    Active Routines
                  </p>
                  <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                    Runs
                  </h2>
                </div>
                <Badge tone="info">
                  <Activity size={14} />
                  {visibleRuns.length}
                </Badge>
              </div>

              {visibleRuns.length === 0 ? (
                <div className="empty-state">No runs yet.</div>
              ) : (
                <div className="run-list">
                  {visibleRuns.map((run) => (
                    <div key={run.runId} className="run-row">
                      <div className="run-row__header">
                        <div className="stack" style={{ gap: 8 }}>
                          <div className="row-actions" style={{ gap: 10, alignItems: 'center' }}>
                            <p className="run-title">{run.goal}</p>
                            {run.mode === 'ai_assist' ? <Badge tone="info">AI Assist</Badge> : <Badge tone="warning">Manual</Badge>}
                          </div>
                          <p className="run-meta mono">
                            {run.runId} • {run.deviceId} • Created {formatDateTime(run.createdAt)}
                          </p>
                          {run.constraints ? (
                            <p className="run-meta">
                              Actions: {run.actionCount || 0}/{run.constraints.maxActions} • Max runtime {run.constraints.maxRuntimeMinutes} min
                            </p>
                          ) : null}
                          {(run.steps || []).length > 0 ? (
                            <p className="run-meta">
                              Progress: {getCompletedStepsCount(run)}/{(run.steps || []).length} steps
                            </p>
                          ) : null}
                        </div>

                        <div className="stack" style={{ gap: 10, minWidth: 140 }}>
                          <Badge tone={getStatusTone(run.status)}>{run.status}</Badge>
                          <div className="row-actions">
                            <Button variant="ghost" onClick={() => void handleSelectRunTools(run.runId)}>
                              Tools
                            </Button>
                            {run.status === 'queued' || run.status === 'running' || run.status === 'waiting_for_user' ? (
                              <Button variant="danger" onClick={() => void handleCancelRun(run.runId)}>
                                <Square size={16} />
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {run.latestProposal ? (
                        <div className="tool-row" style={{ marginTop: 16 }}>
                          <div className="row-actions" style={{ marginBottom: 8 }}>
                            <Badge tone="warning">Latest AI Proposal</Badge>
                          </div>
                          {renderLatestProposal(run.latestProposal)}
                        </div>
                      ) : null}

                      {runTools[run.runId]?.length ? (
                        <div className="tool-list" style={{ marginTop: 16 }}>
                          {runTools[run.runId].slice(0, 4).map((tool) => (
                            <div key={tool.toolEventId} className="tool-row" style={{ padding: 14 }}>
                              <div className="row-actions" style={{ justifyContent: 'space-between', gap: 10 }}>
                                <p className="small-note">
                                  {tool.tool}
                                  {tool.pathRel ? ` → ${tool.pathRel}` : ''}
                                  {tool.cmd ? ` → ${tool.cmd}` : ''}
                                </p>
                                <Badge tone={getStatusTone(tool.status)}>{tool.status}</Badge>
                              </div>
                              <p className="small-note mono" style={{ marginTop: 8 }}>
                                {formatClockTime(tool.at)}
                                {tool.exitCode !== undefined ? ` • exit:${tool.exitCode}` : ''}
                                {tool.errorCode ? ` • err:${tool.errorCode}` : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {(run.steps || []).length > 0 ? (
                        <div style={{ marginTop: 16, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${(getCompletedStepsCount(run) / Math.max((run.steps || []).length, 1)) * 100}%`,
                              background: run.status === 'done' ? '#34d399' : run.status === 'failed' || run.status === 'canceled' ? '#f87171' : '#f4f4f5',
                            }}
                          />
                        </div>
                      ) : null}

                      {run.reason ? (
                        <Banner tone={run.status === 'canceled' ? 'warning' : 'danger'} style={{ marginTop: 16 }}>
                          {run.reason}
                        </Banner>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {selectedRunId ? (
            <Card>
              <div className="stack" style={{ gap: 16 }}>
                <div className="split">
                  <div>
                    <p className="section-title" style={{ marginBottom: 0 }}>
                      Tools
                    </p>
                    <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                      Tools
                    </h2>
                  </div>
                  <Button variant="ghost" onClick={() => setSelectedRunId(null)}>
                    <X size={16} />
                    Close
                  </Button>
                </div>
                <p className="small-note mono">Run: {selectedRunId}</p>

                {runTools[selectedRunId]?.length ? (
                  <div className="tool-list">
                    {runTools[selectedRunId].map((tool) => (
                      <div key={tool.toolEventId} className="tool-row">
                        <div className="row-actions" style={{ justifyContent: 'space-between', gap: 10 }}>
                          <p className="small-note">
                            {tool.tool}
                            {tool.pathRel ? ` • ${tool.pathRel}` : ''}
                            {tool.cmd ? ` • ${tool.cmd}` : ''}
                          </p>
                          <Badge tone={getStatusTone(tool.status)}>{tool.status}</Badge>
                        </div>
                        <p className="small-note mono" style={{ marginTop: 8 }}>
                          {formatClockTime(tool.at)}
                          {tool.exitCode !== undefined ? ` • exit:${tool.exitCode}` : ''}
                          {tool.truncated !== undefined ? ` • truncated:${tool.truncated ? 'yes' : 'no'}` : ''}
                          {tool.errorCode ? ` • err:${tool.errorCode}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No tool events yet for this run.</div>
                )}
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="stack" style={{ gap: 16 }}>
              <div className="split">
                <div>
                  <p className="section-title" style={{ marginBottom: 0 }}>
                    Telemetry
                  </p>
                  <h2 className="section-heading" style={{ fontSize: 22, marginTop: 10 }}>
                    Telemetry
                  </h2>
                </div>
                <Terminal size={20} color="rgba(255,255,255,0.44)" />
              </div>
              <div className="terminal-log">
                {telemetry.length === 0 ? (
                  <div>Waiting for system activity...</div>
                ) : (
                  telemetry.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)
                )}
              </div>
              <p className="small-note">Updates stream through SSE and local dashboard actions.</p>
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}
