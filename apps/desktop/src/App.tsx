import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ServerMessage, ServerChatMessage, RunWithSteps, ApprovalRequest, InputAction, AgentProposal, RunMode } from '@ai-operator/shared';
import { WsClient, type ConnectionStatus } from './lib/wsClient.js';
import { executeAction } from './lib/actionExecutor.js';
import {
  APPROVAL_TIMEOUT_MS,
  approvalController,
  getApprovalRiskForAction,
  getApprovalRiskForTool,
  summarizeInputAction,
  summarizeToolCall,
  type ApprovalChangeEvent,
  type ApprovalItem,
} from './lib/approvals.js';
import { AiAssistController, hasLlMProviderConfigured, type LlmSettings, type LocalToolEvent } from './lib/aiAssist.js';
import { desktopRuntimeConfig } from './lib/desktopRuntimeConfig.js';
import { logoutDesktopSession, startDesktopSignIn } from './lib/desktopAuth.js';
import { getDesktopAccount, revokeDesktopDevice, type DesktopAccountSnapshot } from './lib/desktopAccount.js';
import { createDesktopRun, getDesktopTaskBootstrap, type DesktopTaskBootstrap } from './lib/desktopTasks.js';
import {
  getPermissionStatus,
  openPermissionSettings,
  type NativePermissionStatus,
  type PermissionTarget,
} from './lib/permissions.js';
import { getWorkspaceState, type LocalWorkspaceState } from './lib/workspace.js';
import { getSettings, setSetting, subscribe, updateSettings, type LocalSettingsState } from './lib/localSettings.js';
import { evaluateDesktopTaskReadiness } from './lib/taskReadiness.js';
import { ChatOverlay } from './components/ChatOverlay.js';
import { RunPanel } from './components/RunPanel.js';
import { ApprovalModal } from './components/ApprovalModal.js';
import { ScreenPanel } from './components/ScreenPanel.js';
import { ControlPanel } from './components/ControlPanel.js';
import { ActionApprovalModal } from './components/ActionApprovalModal.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { AgentWorkflow } from './components/AgentWorkflow.js';
import { ToolApprovalModal } from './components/ToolApprovalModal.js';
import { AgentTaskDialog } from './components/agent/index.js';

// Get or create a stable device ID
function getOrCreateDeviceId(): string {
  const key = 'ai-operator-device-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

const LEGACY_DEVICE_TOKEN_KEY = 'ai-operator-device-token';
const LLM_SETTINGS_STORAGE_KEY = 'ai-operator-settings';

async function getStoredDeviceToken(deviceId: string): Promise<string | undefined> {
  const token = await invoke<string | null>('device_token_get', { deviceId });
  return token || undefined;
}

async function setStoredDeviceToken(deviceId: string, token: string): Promise<void> {
  const result = await invoke<{ ok: boolean; error?: string }>('device_token_set', { deviceId, token });
  if (!result.ok) {
    throw new Error(result.error || 'Failed to store device token');
  }
}

async function clearStoredDeviceToken(deviceId: string): Promise<void> {
  const result = await invoke<{ ok: boolean; error?: string }>('device_token_clear', { deviceId });
  if (!result.ok) {
    throw new Error(result.error || 'Failed to clear device token');
  }
}

async function migrateLegacyDeviceToken(deviceId: string): Promise<string | undefined> {
  const legacyToken = localStorage.getItem(LEGACY_DEVICE_TOKEN_KEY) || undefined;
  if (!legacyToken) {
    return undefined;
  }

  try {
    await setStoredDeviceToken(deviceId, legacyToken);
    localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY);
  } catch (err) {
    console.error('[App] Failed to migrate legacy device token:', err);
  }

  return legacyToken;
}

// Detect platform
function detectPlatform(): 'macos' | 'windows' | 'linux' | 'unknown' {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('mac')) return 'macos';
  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('linux')) return 'linux';
  return 'unknown';
}

interface ChatItem {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

interface PendingControlApprovalPayload {
  actionId: string;
  action: InputAction;
}

type PendingProposalPayload =
  | {
      proposalId: string;
      proposal: Extract<AgentProposal, { kind: 'propose_action' }>;
    }
  | {
      proposalId: string;
      proposal: Extract<AgentProposal, { kind: 'propose_tool' }>;
    };

const DEFAULT_PERMISSION_STATUS: NativePermissionStatus = {
  screenRecording: 'unknown',
  accessibility: 'unknown',
};

function getLlmDefaults(provider: LlmSettings['provider']): LlmSettings {
  if (provider === 'openai_compat') {
    return {
      provider,
      baseUrl: 'http://127.0.0.1:8000',
      model: 'qwen2.5-7b-instruct',
    };
  }

  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4.1-mini',
  };
}

function mergeLlmSettings(input?: Partial<LlmSettings>): LlmSettings {
  const provider = input?.provider === 'openai_compat' ? 'openai_compat' : 'openai';
  return {
    ...getLlmDefaults(provider),
    ...input,
    provider,
  };
}

function persistLlmSettings(settings: LlmSettings): void {
  localStorage.setItem(LLM_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function upsertRunHistory(runs: RunWithSteps[], run: RunWithSteps): RunWithSteps[] {
  const withoutCurrent = runs.filter((candidate) => candidate.runId !== run.runId);
  return [run, ...withoutCurrent]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 12);
}

function getNextPendingApproval(items: ApprovalItem[], kind: ApprovalItem['kind']): ApprovalItem | null {
  const pending = items
    .filter((item) => item.kind === kind && item.state === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  return pending[0] || null;
}

function App() {
  const [client, setClient] = useState<WsClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(desktopRuntimeConfig.ok ? 'disconnected' : 'error');
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [authState, setAuthState] = useState<'checking' | 'signed_out' | 'signing_in' | 'signed_in' | 'signing_out'>('checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionDeviceToken, setSessionDeviceToken] = useState<string | null>(null);
  const [desktopBootstrap, setDesktopBootstrap] = useState<DesktopTaskBootstrap | null>(null);
  const [desktopBootstrapBusy, setDesktopBootstrapBusy] = useState(false);
  const [desktopBootstrapError, setDesktopBootstrapError] = useState<string | null>(null);
  const [desktopAccount, setDesktopAccount] = useState<DesktopAccountSnapshot | null>(null);
  const [desktopAccountBusy, setDesktopAccountBusy] = useState(false);
  const [desktopAccountError, setDesktopAccountError] = useState<string | null>(null);
  const [deviceRevokeBusyId, setDeviceRevokeBusyId] = useState<string | null>(null);
  const [taskGoal, setTaskGoal] = useState('');
  const [taskMode, setTaskMode] = useState<RunMode>('ai_assist');
  const [taskCreateBusy, setTaskCreateBusy] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunWithSteps[]>([]);
  const [localSettings, setLocalSettingsState] = useState<LocalSettingsState>(() => getSettings());
  const [autostartSupported, setAutostartSupported] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [windowVisible, setWindowVisible] = useState(true);
  const [trayNotice, setTrayNotice] = useState<string | null>(null);
  
  // Run state
  const [activeRun, setActiveRun] = useState<RunWithSteps | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ runId: string; approval: ApprovalRequest } | null>(null);
  
  // Control state
  const [inputPermissionError, setInputPermissionError] = useState<string | null>(null);
  const [approvalItems, setApprovalItems] = useState<ApprovalItem[]>(() => approvalController.getItems());
  const [permissionStatus, setPermissionStatus] = useState<NativePermissionStatus>(DEFAULT_PERMISSION_STATUS);
  const [permissionStatusBusy, setPermissionStatusBusy] = useState(false);
  const [permissionHintTarget, setPermissionHintTarget] = useState<PermissionTarget | null>(null);
  const [permissionHintMessage, setPermissionHintMessage] = useState<string | null>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string | null>(null);

  // Iteration 6: AI Assist state
  const [aiController, setAiController] = useState<AiAssistController | null>(null);
  const aiControllerRef = useRef<AiAssistController | null>(null);
  const [aiState, setAiState] = useState<AiAssistController['state'] | null>(null);
  const [currentProposal, setCurrentProposal] = useState<AgentProposal | undefined>(undefined);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(() => getLlmDefaults('openai'));
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [providerCheckBusy, setProviderCheckBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentWorkflowOpen, setAgentWorkflowOpen] = useState(false);
  const [primaryDisplayId, setPrimaryDisplayId] = useState<string>('display-0');
  const [workspaceState, setWorkspaceState] = useState<LocalWorkspaceState>({ configured: false });
  const [toolHistoryByRun, setToolHistoryByRun] = useState<Record<string, LocalToolEvent[]>>({});
  const controlEnabledRef = useRef(localSettings.allowControlEnabled);
  const workspaceConfiguredRef = useRef(workspaceState.configured);
  const clientRef = useRef<WsClient | null>(null);
  const controlApprovalPayloadsRef = useRef(new Map<string, PendingControlApprovalPayload>());
  const proposalApprovalPayloadsRef = useRef(new Map<string, PendingProposalPayload>());
  const runtimeConfig = desktopRuntimeConfig.ok ? desktopRuntimeConfig.config : null;
  const runtimeConfigError = desktopRuntimeConfig.ok ? null : desktopRuntimeConfig.message;
  const isSignedIn = Boolean(sessionDeviceToken);

  const refreshPermissionStatus = useCallback(async () => {
    setPermissionStatusBusy(true);
    try {
      const nextStatus = await getPermissionStatus();
      setPermissionStatus(nextStatus);
    } catch (err) {
      console.error('[App] Failed to load permission status:', err);
    } finally {
      setPermissionStatusBusy(false);
    }
  }, []);

  const notePermissionIssue = useCallback((target: PermissionTarget, message: string) => {
    setPermissionHintTarget(target);
    setPermissionHintMessage(message);
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  const handleOpenPermissionSettings = useCallback(async (target: PermissionTarget) => {
    try {
      await openPermissionSettings(target);
      setDiagnosticsStatus(
        target === 'screenRecording'
          ? 'Opened Screen Recording settings.'
          : 'Opened Accessibility settings.'
      );
    } catch (err) {
      setDiagnosticsStatus(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleExportDiagnostics = useCallback(async () => {
    const payload = approvalController.exportDiagnostics(permissionStatus);
    try {
      await navigator.clipboard.writeText(payload);
      setDiagnosticsStatus('Redacted diagnostics copied to clipboard.');
    } catch (err) {
      setDiagnosticsStatus(err instanceof Error ? err.message : 'Failed to copy diagnostics.');
    }
  }, [permissionStatus]);

  const handleApprovalEvent = useCallback((event?: ApprovalChangeEvent) => {
    if (!event) {
      return;
    }

    const item = event.item;

    if (item.kind === 'control_action') {
      const payload = controlApprovalPayloadsRef.current.get(item.id);
      if (!payload) {
        return;
      }

      if (item.state === 'denied') {
        clientRef.current?.sendActionAck(payload.actionId, 'denied');
        clientRef.current?.sendActionResult(payload.actionId, false, {
          code: 'DENIED_BY_USER',
          message: 'User denied the action',
        });
        controlApprovalPayloadsRef.current.delete(item.id);
      } else if (item.state === 'expired') {
        clientRef.current?.sendActionResult(payload.actionId, false, {
          code: 'APPROVAL_EXPIRED',
          message: 'Local approval expired before execution',
        });
        controlApprovalPayloadsRef.current.delete(item.id);
      } else if (item.state === 'canceled') {
        clientRef.current?.sendActionResult(payload.actionId, false, {
          code: 'CANCELED',
          message: item.error || 'Local approval was canceled',
        });
        controlApprovalPayloadsRef.current.delete(item.id);
      } else if (item.state === 'executed' || item.state === 'failed') {
        controlApprovalPayloadsRef.current.delete(item.id);
      }

      return;
    }

    const proposalPayload = proposalApprovalPayloadsRef.current.get(item.id);
    if (!proposalPayload) {
      return;
    }

    if (item.state === 'denied' || item.state === 'expired' || item.state === 'canceled') {
      const resume =
        item.state !== 'canceled' ||
        !item.error ||
        (!item.error.includes('Stop all') &&
          !item.error.includes('Screen Preview disabled') &&
          !item.error.includes('AI Assist paused') &&
          !item.error.includes('AI Assist stopped'));
      aiControllerRef.current?.dismissPendingProposal(
        item.state === 'denied'
          ? 'User denied the pending proposal'
          : item.state === 'expired'
          ? 'Approval expired before execution'
          : item.error || 'Proposal canceled',
        resume
      );
      proposalApprovalPayloadsRef.current.delete(item.id);
    } else if (item.state === 'executed' || item.state === 'failed') {
      proposalApprovalPayloadsRef.current.delete(item.id);
    }
  }, []);

  useEffect(() => {
    aiControllerRef.current = aiController;
  }, [aiController]);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    controlEnabledRef.current = localSettings.allowControlEnabled;
  }, [localSettings.allowControlEnabled]);

  useEffect(() => {
    workspaceConfiguredRef.current = workspaceState.configured;
  }, [workspaceState.configured]);

  useEffect(() => {
    persistLlmSettings(llmSettings);
  }, [llmSettings]);

  useEffect(() => {
    let cancelled = false;

    if (llmSettings.provider === 'openai_compat') {
      setProviderConfigured(true);
      setProviderCheckBusy(false);
      return;
    }

    setProviderCheckBusy(true);
    void hasLlMProviderConfigured(llmSettings.provider)
      .then((configured) => {
        if (!cancelled) {
          setProviderConfigured(configured);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviderConfigured(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProviderCheckBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [llmSettings.provider]);

  useEffect(() => {
    setLocalSettingsState(getSettings());
    const unsubscribe = subscribe((nextSettings) => {
      setLocalSettingsState(nextSettings);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  useEffect(() => {
    approvalController.start();
    const unsubscribe = approvalController.subscribe((items, event) => {
      setApprovalItems(items);
      handleApprovalEvent(event);
    });
    return () => {
      unsubscribe();
    };
  }, [handleApprovalEvent]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const supported = await invoke<boolean>('autostart_supported');
        if (cancelled) {
          return;
        }
        setAutostartSupported(supported);

        if (supported) {
          const enabled = await invoke<boolean>('autostart_is_enabled');
          if (!cancelled) {
            setSetting('autostartEnabled', enabled);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setAutostartError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const registrations = await Promise.all([
        listen('tray.toggle_screen_preview', () => {
          setSetting('screenPreviewEnabled', !getSettings().screenPreviewEnabled);
        }),
        listen('tray.toggle_allow_control', () => {
          setSetting('allowControlEnabled', !getSettings().allowControlEnabled);
        }),
        listen('tray.toggle_ai_pause', () => {
          const controller = aiControllerRef.current;
          if (!controller) {
            return;
          }

          if (controller.isPaused()) {
            controller.resume();
          } else {
            controller.pause();
          }
          setAiState(controller.getState());
        }),
        listen('tray.show', () => {
          setWindowVisible(true);
        }),
        listen('tray.hide', () => {
          setWindowVisible(false);
        }),
        listen('tray.tip', () => {
          setTrayNotice('App is still running in the tray. Use Quit from the tray menu to exit.');
        }),
      ]);

      if (disposed) {
        for (const unlisten of registrations) {
          unlisten();
        }
        return;
      }

      unlisteners.push(...registrations);
    })();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!trayNotice) {
      return;
    }

    const timer = setTimeout(() => {
      setTrayNotice(null);
    }, 5000);

    return () => {
      clearTimeout(timer);
    };
  }, [trayNotice]);

  useEffect(() => {
    if (!diagnosticsStatus) {
      return;
    }

    const timer = setTimeout(() => {
      setDiagnosticsStatus(null);
    }, 4000);

    return () => {
      clearTimeout(timer);
    };
  }, [diagnosticsStatus]);

  // Initialize client on mount
  useEffect(() => {
    const id = getOrCreateDeviceId();
    let disposed = false;
    let wsClient: WsClient | null = null;
    setDeviceId(id);

    // Load LLM settings
    const saved = localStorage.getItem(LLM_SETTINGS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<LlmSettings>;
        setLlmSettings(mergeLlmSettings(parsed));
      } catch {
        // Ignore parse errors
      }
    }

    getWorkspaceState()
      .then((state) => {
        if (!disposed) {
          setWorkspaceState(state);
        }
      })
      .catch((err) => {
        console.error('[App] Failed to load workspace state:', err);
      });

    void (async () => {
      if (!runtimeConfig) {
        console.error('[App] Desktop API configuration invalid:', runtimeConfigError || 'unknown error');
        setStatus('error');
        setAuthState('signed_out');
        return;
      }

      let deviceToken: string | undefined;

      try {
        deviceToken = await getStoredDeviceToken(id);
      } catch (err) {
        console.error('[App] Failed to read device token from keychain:', err);
      }

      if (!deviceToken) {
        deviceToken = await migrateLegacyDeviceToken(id);
      }

      if (disposed) {
        return;
      }

      setSessionDeviceToken(deviceToken || null);
      setAuthState(deviceToken ? 'signed_in' : 'signed_out');

      wsClient = new WsClient({
        deviceId: id,
        deviceName: `Desktop-${id.slice(0, 8)}`,
        platform: detectPlatform(),
        appVersion: '0.0.6',
        deviceToken,
        onStatusChange: (newStatus) => {
          console.log('[App] Connection status:', newStatus);
          setStatus(newStatus);
        },
        onMessage: (message: ServerMessage) => {
          handleServerMessage(message);
        },
        onError: (error) => {
          console.error('[App] Server error:', error);
        },
        // Run callbacks
        onRunDetails: (run) => {
          console.log('[App] Run details received:', run.runId);
          setActiveRun(run);
        },
        onStepUpdate: (runId, step) => {
          console.log('[App] Step update:', runId, step.stepId, step.status);
          setActiveRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            const updatedSteps = prev.steps.map((s) =>
              s.stepId === step.stepId ? step : s
            );
            return { ...prev, steps: updatedSteps, status: step.status === 'blocked' ? 'waiting_for_user' : prev.status };
          });
        },
        onRunLog: (runId, stepId, log) => {
          setActiveRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            const updatedSteps = prev.steps.map((s) => {
              if (s.stepId === stepId) {
                const newLogs = [...s.logs, log];
                // Keep last 1000 logs
                if (newLogs.length > 1000) newLogs.shift();
                return { ...s, logs: newLogs };
              }
              return s;
            });
            return { ...prev, steps: updatedSteps };
          });
        },
        onApprovalRequest: (runId, approval) => {
          console.log('[App] Approval request:', runId, approval.approvalId);
          setPendingApproval({ runId, approval });
          setActiveRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            return { ...prev, pendingApproval: approval, status: 'waiting_for_user' };
          });
        },
        onRunCanceled: (runId) => {
          console.log('[App] Run canceled:', runId);
          setActiveRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            return { ...prev, status: 'canceled' };
          });
          // Stop AI if running
          aiControllerRef.current?.stop('Run canceled');
        },
        onDeviceToken: (nextDeviceToken) => {
          void setStoredDeviceToken(id, nextDeviceToken).catch((err) => {
            console.error('[App] Failed to store device token:', err);
          });
          setSessionDeviceToken(nextDeviceToken);
          setAuthState('signed_in');
          wsClient?.setDeviceToken(nextDeviceToken);
          wsClient?.sendDeviceTokenAck();
          return { ok: true as const };
        },
        // Control callbacks
        onActionRequest: (actionId, action) => {
          console.log('[App] Action request:', actionId, action.kind);
          const createdAt = Date.now();
          const approvalId = approvalController.createApproval({
            kind: 'control_action',
            createdAt,
            expiresAt: createdAt + APPROVAL_TIMEOUT_MS,
            summary: summarizeInputAction(action),
            risk: getApprovalRiskForAction(action),
            actionId,
            source: 'web',
          });

          controlApprovalPayloadsRef.current.set(approvalId, {
            actionId,
            action,
          });

          if (!controlEnabledRef.current) {
            approvalController.cancel(approvalId, 'Allow Control disabled');
            return {
              ok: false as const,
              errorCode: 'POLICY_DENIED' as const,
              retryable: false,
            };
          }

          wsClient?.sendActionAck(actionId, 'awaiting_user');
          return { ok: true as const };
        },
        // Iteration 6: AI Assist callbacks
        onRunStart: (runId, goal, mode) => {
          console.log('[App] Run started:', runId, 'mode:', mode);
          if (mode === 'ai_assist') {
            // Start AI Assist controller
            startAiAssist(runId, goal);
          }
          return { ok: true as const };
        },
      });

      setClient(wsClient);
      if (deviceToken) {
        wsClient.connect(runtimeConfig.wsUrl);
      }

      if (getSettings().startMinimizedToTray) {
        setTimeout(() => {
          void invoke('main_window_hide').catch((err) => {
            console.error('[App] Failed to hide main window on launch:', err);
          });
        }, 300);
      }
    })();

    return () => {
      disposed = true;
      wsClient?.disconnect();
      aiControllerRef.current?.stop('Component unmounting');
    };
  }, []);

  useEffect(() => {
    if (client && status === 'connected') {
      client.sendWorkspaceState(workspaceState);
    }
  }, [client, status, workspaceState]);

  useEffect(() => {
    if (client && status === 'connected') {
      client.sendControlState(localSettings.allowControlEnabled, 'local_user');
    }
  }, [client, status, localSettings.allowControlEnabled]);

  useEffect(() => {
    if (!client) {
      return;
    }

    client.setPingIntervalMs(windowVisible ? 30000 : 15000);
  }, [client, windowVisible]);

  useEffect(() => {
    if (!runtimeConfig || !sessionDeviceToken || authState !== 'signed_in') {
      setDesktopBootstrap(null);
      setDesktopBootstrapBusy(false);
      setDesktopBootstrapError(null);
      setRecentRuns([]);
      return;
    }

    let cancelled = false;
    setDesktopBootstrapBusy(true);
    setDesktopBootstrapError(null);

    void getDesktopTaskBootstrap(runtimeConfig, sessionDeviceToken)
      .then((bootstrap) => {
        if (cancelled) {
          return;
        }

        setDesktopBootstrap(bootstrap);
        setRecentRuns(bootstrap.runs);
        setActiveRun((current) => current ?? bootstrap.activeRun ?? bootstrap.runs[0] ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setDesktopBootstrapError(err instanceof Error ? err.message : 'Failed to load desktop task state');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDesktopBootstrapBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authState, runtimeConfig, sessionDeviceToken]);

  useEffect(() => {
    if (!runtimeConfig || !sessionDeviceToken || authState !== 'signed_in') {
      setDesktopAccount(null);
      setDesktopAccountBusy(false);
      setDesktopAccountError(null);
      setDeviceRevokeBusyId(null);
      return;
    }

    let cancelled = false;
    setDesktopAccountBusy(true);
    setDesktopAccountError(null);

    void getDesktopAccount(runtimeConfig, sessionDeviceToken)
      .then((account) => {
        if (!cancelled) {
          setDesktopAccount(account);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDesktopAccountError(err instanceof Error ? err.message : 'Failed to load desktop account');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDesktopAccountBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authState, runtimeConfig, sessionDeviceToken]);

  useEffect(() => {
    if (!activeRun) {
      return;
    }

    setRecentRuns((currentRuns) => upsertRunHistory(currentRuns, activeRun));
  }, [activeRun]);

  useEffect(() => {
    void invoke('tray_update_state', {
      windowVisible,
      screenPreviewEnabled: localSettings.screenPreviewEnabled,
      allowControlEnabled: localSettings.allowControlEnabled,
      aiAssistActive: Boolean(aiState?.isRunning),
      aiAssistPaused: aiState?.status === 'paused',
    }).catch((err) => {
      console.error('[App] Failed to sync tray state:', err);
    });
  }, [
    windowVisible,
    localSettings.screenPreviewEnabled,
    localSettings.allowControlEnabled,
    aiState?.isRunning,
    aiState?.status,
  ]);

  useEffect(() => {
    if (aiState?.status !== 'awaiting_approval' || !aiState.currentProposalId || !currentProposal) {
      return;
    }

    for (const payload of proposalApprovalPayloadsRef.current.values()) {
      if (payload.proposalId === aiState.currentProposalId) {
        return;
      }
    }

    const createdAt = Date.now();

    if (currentProposal.kind === 'propose_action') {
      const approvalId = approvalController.createApproval({
        kind: 'ai_proposal',
        createdAt,
        expiresAt: createdAt + APPROVAL_TIMEOUT_MS,
        summary: summarizeInputAction(currentProposal.action),
        risk: getApprovalRiskForAction(currentProposal.action),
        runId: activeRun?.runId,
        source: 'agent',
      });
      proposalApprovalPayloadsRef.current.set(approvalId, {
        proposalId: aiState.currentProposalId,
        proposal: currentProposal,
      });
      return;
    }

    if (currentProposal.kind === 'propose_tool') {
      const approvalId = approvalController.createApproval({
        kind: 'tool_call',
        createdAt,
        expiresAt: createdAt + APPROVAL_TIMEOUT_MS,
        summary: summarizeToolCall(currentProposal.toolCall),
        risk: getApprovalRiskForTool(currentProposal.toolCall),
        runId: activeRun?.runId,
        toolId: aiState.currentProposalId,
        source: 'agent',
      });
      proposalApprovalPayloadsRef.current.set(approvalId, {
        proposalId: aiState.currentProposalId,
        proposal: currentProposal,
      });
    }
  }, [activeRun?.runId, aiState?.currentProposalId, aiState?.status, currentProposal]);

  useEffect(() => {
    if (!localSettings.allowControlEnabled) {
      approvalController.cancelAllPending('Allow Control disabled', (item) => item.kind === 'control_action');
      setInputPermissionError(null);
    }
  }, [localSettings.allowControlEnabled]);

  useEffect(() => {
    if (!localSettings.screenPreviewEnabled) {
      approvalController.cancelAllPending('Screen Preview disabled', (item) =>
        item.kind === 'ai_proposal' || item.kind === 'tool_call'
      );
    }
  }, [localSettings.screenPreviewEnabled]);

  useEffect(() => {
    if (!workspaceState.configured) {
      approvalController.cancelAllPending('Workspace cleared', (item) => item.kind === 'tool_call');
    }
  }, [workspaceState.configured]);

  useEffect(() => {
    if (aiState?.status === 'paused') {
      approvalController.cancelAllPending('AI Assist paused', (item) =>
        item.kind === 'ai_proposal' || item.kind === 'tool_call'
      );
    }
  }, [aiState?.status]);

  // Start AI Assist mode
  const startAiAssist = async (runId: string, goal: string) => {
    if (!client) return;

    const hasKey = await hasLlMProviderConfigured(llmSettings.provider);

    if (!hasKey) {
      client.sendRunLog(runId, 'AI Assist cannot start: LLM API key not configured', 'error');
      client.sendRunUpdate(runId, 'failed', 'LLM_NOT_CONFIGURED');
      setSettingsOpen(true);
      return;
    }

    const controller = new AiAssistController({
      wsClient: client,
      deviceId,
      runId,
      goal,
      constraints: { maxActions: 20, maxRuntimeMinutes: 20 },
      displayId: primaryDisplayId,
      onStateChange: (state) => {
        setAiState(state);
        setCurrentProposal(state.currentProposal);
      },
      onProposal: (proposal) => {
        setCurrentProposal(proposal);
      },
      onToolEvent: (event) => {
        setToolHistoryByRun((prev) => {
          const runHistory = prev[event.runId || runId] || [];
          const existing = runHistory.find((item) => item.toolEventId === event.toolEventId);
          const nextRunHistory = existing
            ? runHistory.map((item) => (item.toolEventId === event.toolEventId ? event : item))
            : [event, ...runHistory].slice(0, 20);
          return {
            ...prev,
            [event.runId || runId]: nextRunHistory,
          };
        });
      },
      onError: (error) => {
        console.error('[App] AI Assist error:', error);
      },
    });

    setAiController(controller);
    const started = await controller.start(llmSettings);
    
    if (!started) {
      setAiController(null);
    }
  };

  // Handle server messages
  const handleServerMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'server.chat.message': {
        const payload = (message as ServerChatMessage).payload;
        const msg = payload.message;
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            role: msg.role,
            text: msg.text,
            timestamp: msg.createdAt,
          },
        ]);
        break;
      }

      case 'server.run.status': {
        setActiveRun((prev) => {
          if (!prev || prev.runId !== message.payload.runId) return prev;
          return { ...prev, status: message.payload.status };
        });
        break;
      }
    }
  }, []);

  // Handle sending a chat message
  const handleSendMessage = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          role: 'user',
          text,
          timestamp: Date.now(),
        },
      ]);
      client?.sendChat(text, activeRun?.runId);
      
      // If AI is asking for user input, send response
      if (aiController && aiState?.status === 'asking_user') {
        aiController.userResponse(text);
      }
    },
    [client, activeRun, aiController, aiState]
  );

  const handleDesktopSignIn = useCallback(async () => {
    if (!runtimeConfig) {
      setAuthError(runtimeConfigError || 'Desktop API configuration is invalid');
      return;
    }

    if (!deviceId || !client) {
      setAuthError('Desktop sign-in is still initializing. Try again in a moment.');
      return;
    }

    setAuthError(null);
    setAuthState('signing_in');

    try {
      const result = await startDesktopSignIn({
        runtimeConfig,
        deviceId,
      });

      await setStoredDeviceToken(deviceId, result.deviceToken);
      setSessionDeviceToken(result.deviceToken);
      setAuthState('signed_in');
      client.setDeviceToken(result.deviceToken);
      client.connect(runtimeConfig.wsUrl);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Desktop sign-in failed');
      setAuthState(sessionDeviceToken ? 'signed_in' : 'signed_out');
    }
  }, [client, deviceId, runtimeConfig, runtimeConfigError, sessionDeviceToken]);

  const handleDesktopSignOut = useCallback(async () => {
    const currentToken = sessionDeviceToken;
    if (!deviceId || !client || !currentToken) {
      setAuthState('signed_out');
      setSessionDeviceToken(null);
      return;
    }

    setAuthError(null);
    setAuthState('signing_out');

    try {
      await clearStoredDeviceToken(deviceId);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Desktop sign-out failed');
      setAuthState('signed_in');
      return;
    }

    let revokeError: string | null = null;
    if (runtimeConfig) {
      try {
        await logoutDesktopSession({
          runtimeConfig,
          deviceToken: currentToken,
        });
      } catch (err) {
        revokeError = err instanceof Error ? err.message : 'Desktop sign-out completed locally, but remote revoke failed';
      }
    }

    client.setDeviceToken(undefined);
    client.disconnect();
    setSessionDeviceToken(null);
    setAuthState('signed_out');
    setDesktopBootstrap(null);
    setDesktopBootstrapError(null);
    setDesktopAccount(null);
    setDesktopAccountError(null);
    setDeviceRevokeBusyId(null);
    setTaskCreateError(null);
    setTaskGoal('');
    setRecentRuns([]);
    setActiveRun(null);
    setPendingApproval(null);
    setMessages([]);
    setCurrentProposal(undefined);
    setToolHistoryByRun({});
    setInputPermissionError(null);
    approvalController.cancelAllPending('Desktop signed out');
    controlApprovalPayloadsRef.current.clear();
    proposalApprovalPayloadsRef.current.clear();
    aiControllerRef.current?.stop('Desktop signed out');
    setAiController(null);
    setAiState(null);
    setAuthError(revokeError);
  }, [client, deviceId, runtimeConfig, sessionDeviceToken]);

  const handleTaskModeChange = useCallback((nextMode: RunMode) => {
    setTaskMode(nextMode);
  }, []);

  const handleLlmProviderChange = useCallback((provider: LlmSettings['provider']) => {
    setLlmSettings((current) => mergeLlmSettings({
      ...current,
      provider,
    }));
  }, []);

  const handleLlmModelChange = useCallback((model: string) => {
    setLlmSettings((current) => ({
      ...current,
      model,
    }));
  }, []);

  const handleCreateTask = useCallback(async () => {
    if (!runtimeConfig || !sessionDeviceToken) {
      setTaskCreateError('Desktop sign-in is required before starting a task.');
      return;
    }

    const nextReadiness = evaluateDesktopTaskReadiness({
      mode: taskMode,
      subscriptionStatus: desktopBootstrap?.billing.subscriptionStatus ?? 'inactive',
      permissionStatus,
      localSettings,
      workspaceConfigured: workspaceState.configured,
      providerConfigured,
    });

    if (!taskGoal.trim()) {
      setTaskCreateError('Enter a task goal before starting.');
      return;
    }

    if (!nextReadiness.ready) {
      setTaskCreateError(nextReadiness.blockers[0]?.detail || 'Desktop is not ready to start a task.');
      return;
    }

    setTaskCreateBusy(true);
    setTaskCreateError(null);

    try {
      const run = await createDesktopRun(runtimeConfig, sessionDeviceToken, {
        goal: taskGoal.trim(),
        mode: taskMode,
      });

      setTaskGoal('');
      setActiveRun(run);
      setRecentRuns((currentRuns) => upsertRunHistory(currentRuns, run));
    } catch (err) {
      setTaskCreateError(err instanceof Error ? err.message : 'Failed to start task');
    } finally {
      setTaskCreateBusy(false);
    }
  }, [
    desktopBootstrap?.billing.subscriptionStatus,
    localSettings,
    permissionStatus,
    providerConfigured,
    runtimeConfig,
    sessionDeviceToken,
    taskGoal,
    taskMode,
    workspaceState.configured,
  ]);

  const handleSelectRecentRun = useCallback((runId: string) => {
    const selected = recentRuns.find((run) => run.runId === runId);
    if (selected) {
      setActiveRun(selected);
    }
  }, [recentRuns]);

  const handleRevokeDesktopDevice = useCallback(async (targetDeviceId: string) => {
    if (!runtimeConfig || !sessionDeviceToken) {
      setDesktopAccountError('Desktop sign-in is required before managing device sessions.');
      return;
    }

    setDeviceRevokeBusyId(targetDeviceId);
    setDesktopAccountError(null);

    try {
      await revokeDesktopDevice(runtimeConfig, sessionDeviceToken, targetDeviceId);
      const refreshed = await getDesktopAccount(runtimeConfig, sessionDeviceToken);
      setDesktopAccount(refreshed);
    } catch (err) {
      setDesktopAccountError(err instanceof Error ? err.message : 'Failed to revoke desktop session');
    } finally {
      setDeviceRevokeBusyId(null);
    }
  }, [runtimeConfig, sessionDeviceToken]);

  // Handle approval decision
  const handleApprovalDecision = useCallback((decision: 'approved' | 'denied', comment?: string) => {
    if (!pendingApproval || !activeRun) return;
    client?.sendApprovalDecision(activeRun.runId, pendingApproval.approval.approvalId, decision, comment);
    setPendingApproval(null);
  }, [client, pendingApproval, activeRun]);

  // Handle cancel run
  const handleCancelRun = useCallback(() => {
    if (!activeRun) return;
    aiController?.stop('User canceled');
    client?.sendRunCancel(activeRun.runId);
  }, [client, activeRun, aiController]);

  // Handle action approval
  const handleActionApprove = useCallback(async () => {
    const approval = getNextPendingApproval(approvalItems, 'control_action');
    if (!approval) {
      return;
    }

    const payload = controlApprovalPayloadsRef.current.get(approval.id);
    const activeClient = clientRef.current;
    if (!payload || !activeClient) {
      return;
    }

    if (!controlEnabledRef.current) {
      approvalController.cancel(approval.id, 'Allow Control disabled');
      return;
    }

    approvalController.approve(approval.id);
    approvalController.markExecuting(approval.id);
    activeClient.sendActionAck(payload.actionId, 'approved');

    const result = await executeAction(payload.action);
    if (!result.ok) {
      setInputPermissionError(result.error?.message || 'Input injection failed');
      if (result.error?.permissionTarget) {
        notePermissionIssue(result.error.permissionTarget, result.error.message);
      }
      approvalController.markFailed(approval.id, result.error?.code || 'EXECUTION_FAILED');
    } else {
      setInputPermissionError(null);
      approvalController.markExecuted(approval.id);
    }

    activeClient.sendActionResult(payload.actionId, result.ok, result.error);
  }, [approvalItems, notePermissionIssue]);

  const handleActionDeny = useCallback(() => {
    const approval = getNextPendingApproval(approvalItems, 'control_action');
    if (!approval) {
      return;
    }
    approvalController.deny(approval.id, 'Denied by user');
  }, [approvalItems]);

  const handleControlToggle = useCallback((enabled: boolean) => {
    setSetting('allowControlEnabled', enabled);
    if (!enabled) {
      setInputPermissionError(null);
    }
  }, []);

  const handleScreenPreviewToggle = useCallback((enabled: boolean) => {
    setSetting('screenPreviewEnabled', enabled);
    if (!enabled) {
      aiControllerRef.current?.pause();
    }
  }, []);

  const handleStartMinimizedChange = useCallback((enabled: boolean) => {
    setSetting('startMinimizedToTray', enabled);
  }, []);

  const handleAutostartChange = useCallback((enabled: boolean) => {
    setAutostartBusy(true);
    setAutostartError(null);

    void invoke<{ ok: boolean; error?: string }>('autostart_set_enabled', { enabled })
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error || 'Failed to update autostart');
        }
        setSetting('autostartEnabled', enabled);
      })
      .catch((err) => {
        setAutostartError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setAutostartBusy(false);
      });
  }, []);

  // Handle AI Assist action approval
  const handleAiApproveAction = useCallback(async () => {
    const approval = getNextPendingApproval(approvalItems, 'ai_proposal');
    if (!approval || !aiControllerRef.current) {
      return;
    }

    approvalController.approve(approval.id);
    approvalController.markExecuting(approval.id);
    const result = await aiControllerRef.current.approveAction();
    if (result.ok) {
      approvalController.markExecuted(approval.id);
      return;
    }

    if (result.error && (result.error.includes('Accessibility') || result.error.includes('permission'))) {
      notePermissionIssue('accessibility', result.error);
    }
    approvalController.markFailed(approval.id, 'EXECUTION_FAILED');
  }, [approvalItems, notePermissionIssue]);

  const handleAiRejectAction = useCallback(() => {
    const approval = getNextPendingApproval(approvalItems, 'ai_proposal');
    if (!approval) {
      return;
    }
    approvalController.deny(approval.id, 'Denied by user');
  }, [approvalItems]);

  const handleAiApproveTool = useCallback(async () => {
    const approval = getNextPendingApproval(approvalItems, 'tool_call');
    if (!approval) {
      return;
    }

    if (!workspaceState.configured) {
      approvalController.cancel(approval.id, 'Workspace cleared');
      return;
    }

    if (!aiControllerRef.current) {
      return;
    }

    approvalController.approve(approval.id);
    approvalController.markExecuting(approval.id);
    const result = await aiControllerRef.current.approveTool();
    if (result.ok) {
      approvalController.markExecuted(approval.id);
      return;
    }

    approvalController.markFailed(approval.id, 'EXECUTION_FAILED');
  }, [approvalItems, workspaceState.configured]);

  const handleAiRejectTool = useCallback(() => {
    const approval = getNextPendingApproval(approvalItems, 'tool_call');
    if (!approval) {
      return;
    }
    approvalController.deny(approval.id, 'Denied by user');
  }, [approvalItems]);

  const handleAiUserResponse = useCallback((response: string) => {
    aiController?.userResponse(response);
  }, [aiController]);

  const handleStopAi = useCallback(() => {
    approvalController.cancelAllPending('AI Assist stopped', (item) =>
      item.kind === 'ai_proposal' || item.kind === 'tool_call'
    );
    aiController?.stop('User stopped');
    if (activeRun) {
      client?.sendRunUpdate(activeRun.runId, 'canceled', 'AI Assist stopped by user');
      setActiveRun((prev) => (prev ? { ...prev, status: 'canceled' } : prev));
    }
    setAiController(null);
    setAiState(null);
    setCurrentProposal(undefined);
  }, [aiController, activeRun, client]);

  const handleStopAll = useCallback(() => {
    const confirmed = window.confirm(
      'Stop all pending approvals, pause AI Assist, and disable screen preview plus remote control?'
    );
    if (!confirmed) {
      return;
    }

    aiControllerRef.current?.pause();
    approvalController.cancelAllPending('Stop all requested');
    updateSettings({
      allowControlEnabled: false,
      screenPreviewEnabled: false,
    });
    setInputPermissionError(null);
  }, []);

  const handleWorkspaceChange = useCallback((state: LocalWorkspaceState) => {
    setWorkspaceState(state);
  }, []);

  const pendingControlApproval = getNextPendingApproval(approvalItems, 'control_action');
  const pendingControlPayload = pendingControlApproval
    ? controlApprovalPayloadsRef.current.get(pendingControlApproval.id) || null
    : null;
  const pendingAiProposalApproval = getNextPendingApproval(approvalItems, 'ai_proposal');
  const pendingToolApproval = getNextPendingApproval(approvalItems, 'tool_call');
  const pendingToolProposal =
    pendingToolApproval && currentProposal?.kind === 'propose_tool' && aiState?.status === 'awaiting_approval'
      ? currentProposal
      : null;
  const isAiAssist = activeRun?.mode === 'ai_assist';
  const activeToolHistory = activeRun ? toolHistoryByRun[activeRun.runId] || [] : [];
  const pendingApprovals = approvalItems
    .filter((item) => item.state === 'pending')
    .sort((left, right) => left.createdAt - right.createdAt);
  const subscriptionStatus = desktopBootstrap?.billing.subscriptionStatus ?? 'inactive';
  const siblingDevices = desktopAccount?.devices.filter((device) => device.deviceId !== desktopAccount.currentDevice?.deviceId) ?? [];
  const taskReadiness = evaluateDesktopTaskReadiness({
    mode: taskMode,
    subscriptionStatus,
    permissionStatus,
    localSettings,
    workspaceConfigured: workspaceState.configured,
    providerConfigured,
  });

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f5f5f5', display: 'flex' }}>
      {/* Main Content */}
      <div style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>AI Operator Desktop</h1>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={handleStopAll}
              disabled={approvalItems.every((item) => item.state !== 'pending') && !aiState?.isRunning}
              style={{
                padding: '0.5rem 1rem',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                opacity: approvalItems.every((item) => item.state !== 'pending') && !aiState?.isRunning ? 0.5 : 1,
              }}
            >
              Stop All
            </button>
            {isSignedIn && (
              <AgentTaskDialog
                trigger={
                  <button
                    style={{
                      padding: '0.5rem 1rem',
                      background: '#f3e8ff',
                      border: '1px solid #a855f7',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      color: '#6b21a8',
                    }}
                  >
                    ✨ Advanced Agent
                  </button>
                }
              />
            )}
            {isSignedIn && (
              <button
                onClick={() => setAgentWorkflowOpen(true)}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#dbeafe',
                  border: '1px solid #3b82f6',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: '#1e40af',
                }}
              >
                🚀 AI Engineer
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              style={{
                padding: '0.5rem 1rem',
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              ⚙️ Settings
            </button>
          </div>
        </div>
        <p>Device ID: <code>{deviceId}</code></p>

        {runtimeConfigError && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#991b1b',
            }}
          >
            <strong>Connection blocked:</strong> {runtimeConfigError}
          </div>
        )}
        
        {/* Connection Status */}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <StatusBadge status={status} />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.25rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              background: workspaceState.configured ? '#dbeafe' : '#f3f4f6',
              color: workspaceState.configured ? '#1d4ed8' : '#6b7280',
            }}
          >
            Workspace: {workspaceState.configured ? workspaceState.rootName || 'Configured' : 'Not set'}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.25rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              background: authState === 'signed_in' ? '#dcfce7' : authState === 'signing_in' || authState === 'signing_out' ? '#fef3c7' : '#f3f4f6',
              color: authState === 'signed_in' ? '#166534' : authState === 'signing_in' || authState === 'signing_out' ? '#92400e' : '#6b7280',
            }}
          >
            Session: {authState === 'signed_in'
              ? 'Signed in'
              : authState === 'signing_in'
                ? 'Signing in'
                : authState === 'signing_out'
                  ? 'Signing out'
                  : authState === 'checking'
                    ? 'Checking'
                    : 'Signed out'}
          </span>
          
          {status === 'disconnected' && runtimeConfig && authState === 'signed_in' && (
            <button onClick={() => client?.connect(runtimeConfig.wsUrl)}>
              Reconnect
            </button>
          )}
        </div>

        {trayNotice && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: '#eff6ff',
              border: '1px solid #93c5fd',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#1d4ed8',
            }}
          >
            {trayNotice}
          </div>
        )}

        {diagnosticsStatus && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: '#ecfdf5',
              border: '1px solid #86efac',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#166534',
            }}
          >
            {diagnosticsStatus}
          </div>
        )}

        {/* Desktop Sign-In */}
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'white', borderRadius: '8px', maxWidth: '400px' }}>
          <h3 style={{ marginTop: 0 }}>Desktop Sign In</h3>

          {!isSignedIn ? (
            <>
              <p style={{ marginTop: 0, color: '#4b5563', fontSize: '0.875rem', lineHeight: 1.5 }}>
                Sign in with your browser to connect this desktop directly to your account.
              </p>
              <button
                onClick={() => {
                  void handleDesktopSignIn();
                }}
                disabled={!runtimeConfig || !deviceId || !client || authState === 'checking' || authState === 'signing_in'}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: !runtimeConfig || !deviceId || !client || authState === 'checking' || authState === 'signing_in' ? '#ccc' : '#0070f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: !runtimeConfig || !deviceId || !client || authState === 'checking' || authState === 'signing_in' ? 'not-allowed' : 'pointer',
                }}
              >
                {authState === 'signing_in' ? 'Opening Browser...' : 'Sign in'}
              </button>
            </>
          ) : (
            <div>
              <p style={{ marginTop: 0, color: '#166534', fontSize: '0.875rem', lineHeight: 1.5 }}>
                This desktop has an active local session and will reconnect automatically with its stored device token.
              </p>
              <button
                onClick={() => {
                  void handleDesktopSignOut();
                }}
                disabled={authState === 'signing_out'}
                style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 0.85rem',
                  background: authState === 'signing_out' ? '#e5e7eb' : '#fff7ed',
                  color: authState === 'signing_out' ? '#6b7280' : '#9a3412',
                  border: '1px solid #fdba74',
                  borderRadius: '6px',
                  cursor: authState === 'signing_out' ? 'not-allowed' : 'pointer',
                }}
              >
                {authState === 'signing_out' ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          )}

          {authError && (
            <p style={{ color: '#b91c1c', fontSize: '0.875rem', marginTop: '0.75rem', marginBottom: 0 }}>
              {authError}
            </p>
          )}
        </div>

        {isSignedIn && (
          <>
            <div
              style={{
                marginTop: '1.5rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '1rem',
              }}
            >
              <section style={{ padding: '1rem', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1rem' }}>Create Task</h2>
                    <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                      Start a run directly from this desktop without using the dashboard.
                    </p>
                  </div>
                  {desktopBootstrap?.user.email && (
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      {desktopBootstrap.user.email}
                    </span>
                  )}
                </div>

                <label style={{ display: 'block', marginTop: '1rem', fontSize: '0.875rem', fontWeight: 600 }}>
                  Task goal
                </label>
                <textarea
                  value={taskGoal}
                  onChange={(event) => setTaskGoal(event.target.value)}
                  placeholder="Example: Inspect the deployment failure, find the root cause, and prepare the fix."
                  style={{
                    width: '100%',
                    minHeight: '96px',
                    marginTop: '0.5rem',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '0.875rem',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>Mode</span>
                    <select
                      value={taskMode}
                      onChange={(event) => handleTaskModeChange(event.target.value as RunMode)}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #d1d5db' }}
                    >
                      <option value="ai_assist">AI Assist</option>
                      <option value="manual">Manual</option>
                    </select>
                  </label>

                  <label style={{ display: 'block', fontSize: '0.875rem' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>Provider</span>
                    <select
                      value={llmSettings.provider}
                      onChange={(event) => handleLlmProviderChange(event.target.value as LlmSettings['provider'])}
                      disabled={taskMode !== 'ai_assist'}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        background: taskMode === 'ai_assist' ? 'white' : '#f3f4f6',
                      }}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="openai_compat">OpenAI-compatible local</option>
                    </select>
                  </label>

                  <label style={{ display: 'block', fontSize: '0.875rem' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>Model</span>
                    <input
                      value={llmSettings.model}
                      onChange={(event) => handleLlmModelChange(event.target.value)}
                      disabled={taskMode !== 'ai_assist'}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        background: taskMode === 'ai_assist' ? 'white' : '#f3f4f6',
                        boxSizing: 'border-box',
                      }}
                    />
                  </label>
                </div>

                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#6b7280' }}>
                  {taskMode === 'ai_assist'
                    ? providerCheckBusy
                      ? 'Checking provider configuration...'
                      : providerConfigured
                        ? 'Provider configured for AI Assist.'
                        : 'Provider setup still required for AI Assist.'
                    : 'Manual mode ignores provider and workspace blockers.'}
                </div>

                {taskCreateError && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.75rem',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      color: '#991b1b',
                    }}
                  >
                    {taskCreateError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button
                    onClick={() => {
                      void handleCreateTask();
                    }}
                    disabled={taskCreateBusy || desktopBootstrapBusy || !taskGoal.trim() || !taskReadiness.ready}
                    style={{
                      padding: '0.75rem 1rem',
                      background: taskCreateBusy || desktopBootstrapBusy || !taskGoal.trim() || !taskReadiness.ready ? '#9ca3af' : '#111827',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: taskCreateBusy || desktopBootstrapBusy || !taskGoal.trim() || !taskReadiness.ready ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {taskCreateBusy ? 'Starting...' : 'Start Task'}
                  </button>
                  <button
                    onClick={() => setSettingsOpen(true)}
                    style={{
                      padding: '0.75rem 1rem',
                      background: 'white',
                      color: '#111827',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Open Settings
                  </button>
                </div>
              </section>

              <section style={{ padding: '1rem', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h2 style={{ margin: 0, fontSize: '1rem' }}>Readiness</h2>
                <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                  Subscription, permissions, workspace, and provider state for this desktop.
                </p>

                {desktopBootstrapBusy && (
                  <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    Loading account and task state...
                  </p>
                )}

                {desktopBootstrapError && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.75rem',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      color: '#991b1b',
                    }}
                  >
                    {desktopBootstrapError}
                  </div>
                )}

                <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Subscription:</strong> {subscriptionStatus === 'active' ? 'Active' : 'Inactive'}
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Screen Preview:</strong> {localSettings.screenPreviewEnabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Screen Recording Permission:</strong> {permissionStatus.screenRecording}
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Allow Control:</strong> {localSettings.allowControlEnabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Accessibility Permission:</strong> {permissionStatus.accessibility}
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Workspace:</strong> {workspaceState.configured ? workspaceState.rootName || 'Configured' : 'Not configured'}
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>Provider:</strong> {providerCheckBusy ? 'Checking...' : providerConfigured ? 'Configured' : 'Not configured'}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem',
                    background: taskReadiness.ready ? '#ecfdf5' : '#fff7ed',
                    border: `1px solid ${taskReadiness.ready ? '#86efac' : '#fdba74'}`,
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    color: taskReadiness.ready ? '#166534' : '#9a3412',
                  }}
                >
                  {taskReadiness.ready
                    ? 'This desktop is ready to start tasks directly.'
                    : `Task start is blocked by ${taskReadiness.blockers.length} readiness item${taskReadiness.blockers.length === 1 ? '' : 's'}.`}
                </div>

                {taskReadiness.blockers.length > 0 && (
                  <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                    {taskReadiness.blockers.map((blocker) => (
                      <div
                        key={blocker.id}
                        style={{
                          padding: '0.75rem',
                          background: '#f9fafb',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb',
                        }}
                      >
                        <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{blocker.label}</div>
                        <div style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#6b7280' }}>{blocker.detail}</div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          {blocker.id === 'screen-preview' && (
                            <button
                              onClick={() => handleScreenPreviewToggle(true)}
                              style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                            >
                              Enable Screen Preview
                            </button>
                          )}
                          {blocker.id === 'control-toggle' && (
                            <button
                              onClick={() => handleControlToggle(true)}
                              style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                            >
                              Enable Allow Control
                            </button>
                          )}
                          {(blocker.id === 'screen-permission' || blocker.id === 'accessibility-permission') && (
                            <button
                              onClick={() => void handleOpenPermissionSettings(blocker.id === 'screen-permission' ? 'screenRecording' : 'accessibility')}
                              style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                            >
                              Open Permission Settings
                            </button>
                          )}
                          {(blocker.id === 'workspace' || blocker.id === 'provider') && (
                            <button
                              onClick={() => setSettingsOpen(true)}
                              style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                            >
                              Open Settings
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section
              style={{
                marginTop: '1rem',
                padding: '1rem',
                background: 'white',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1rem' }}>Account & Devices</h2>
              <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                Manage the signed-in desktop session and any other desktops on this account.
              </p>

              {desktopAccountBusy && (
                <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#6b7280' }}>
                  Loading device sessions...
                </p>
              )}

              {desktopAccountError && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    color: '#991b1b',
                  }}
                >
                  {desktopAccountError}
                </div>
              )}

              {desktopAccount && (
                <div
                  style={{
                    marginTop: '1rem',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '1rem',
                  }}
                >
                  <div
                    style={{
                      padding: '0.75rem',
                      background: '#f9fafb',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Current desktop</div>
                    <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                      {desktopAccount.currentDevice?.deviceName || `Desktop-${deviceId.slice(0, 8)}`}
                    </div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                      {desktopAccount.user.email} • {desktopAccount.billing.subscriptionStatus === 'active' ? 'Subscription active' : 'Subscription inactive'}
                    </div>
                    {desktopAccount.currentDevice && (
                      <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                        {desktopAccount.currentDevice.platform} • {desktopAccount.currentDevice.connected ? 'Connected' : 'Offline'}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      padding: '0.75rem',
                      background: '#f9fafb',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Device Sessions</div>
                    {siblingDevices.length === 0 ? (
                      <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
                        No other signed-in desktops on this account.
                      </p>
                    ) : (
                      <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.5rem' }}>
                        {siblingDevices.map((device) => (
                          <div
                            key={device.deviceId}
                            style={{
                              padding: '0.75rem',
                              background: 'white',
                              borderRadius: '6px',
                              border: '1px solid #e5e7eb',
                            }}
                          >
                            <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                              {device.deviceName || `Desktop-${device.deviceId.slice(0, 8)}`}
                            </div>
                            <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                              {device.platform} • {device.connected ? 'Connected' : 'Offline'} • Last seen {new Date(device.lastSeenAt).toLocaleString()}
                            </div>
                            <button
                              onClick={() => {
                                void handleRevokeDesktopDevice(device.deviceId);
                              }}
                              disabled={deviceRevokeBusyId === device.deviceId}
                              style={{
                                marginTop: '0.5rem',
                                padding: '0.45rem 0.65rem',
                                borderRadius: '6px',
                                border: '1px solid #fdba74',
                                background: deviceRevokeBusyId === device.deviceId ? '#e5e7eb' : '#fff7ed',
                                color: deviceRevokeBusyId === device.deviceId ? '#6b7280' : '#9a3412',
                                cursor: deviceRevokeBusyId === device.deviceId ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {deviceRevokeBusyId === device.deviceId ? 'Revoking...' : 'Revoke session'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <div
              style={{
                marginTop: '1rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '1rem',
              }}
            >
              <section style={{ padding: '1rem', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h2 style={{ margin: 0, fontSize: '1rem' }}>Pending Approvals</h2>
                <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                  Local approvals remain mandatory and are shown here before execution.
                </p>

                {pendingApprovals.length === 0 ? (
                  <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    No pending approvals.
                  </p>
                ) : (
                  <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                    {pendingApprovals.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: '0.75rem',
                          background: '#f9fafb',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb',
                        }}
                      >
                        <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{item.summary}</div>
                        <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                          {item.source} • {item.kind} • expires {new Date(item.expiresAt).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section style={{ padding: '1rem', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h2 style={{ margin: 0, fontSize: '1rem' }}>Recent Tasks</h2>
                <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                  Recent runs for this desktop reuse the existing backend run model and stay visible in the web dashboard.
                </p>

                {recentRuns.length === 0 ? (
                  <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    No recent tasks yet.
                  </p>
                ) : (
                  <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                    {recentRuns.map((run) => (
                      <button
                        key={run.runId}
                        onClick={() => handleSelectRecentRun(run.runId)}
                        style={{
                          textAlign: 'left',
                          padding: '0.75rem',
                          background: activeRun?.runId === run.runId ? '#eff6ff' : '#f9fafb',
                          border: activeRun?.runId === run.runId ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{run.goal}</div>
                        <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                          {run.mode || 'manual'} • {run.status} • {new Date(run.createdAt).toLocaleString()}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {/* Screen Panel */}
        {client && isSignedIn && (
          <ScreenPanel 
            wsClient={client} 
            deviceId={deviceId} 
            enabled={localSettings.screenPreviewEnabled}
            onToggle={handleScreenPreviewToggle}
            onDisplayChange={setPrimaryDisplayId}
            permissionStatus={permissionStatus}
            onOpenPermissionSettings={handleOpenPermissionSettings}
            onPermissionIssue={(message) => notePermissionIssue('screenRecording', message)}
          />
        )}

        {/* Control Panel */}
        {client && isSignedIn && (
          <ControlPanel 
            wsClient={client} 
            deviceId={deviceId} 
            enabled={localSettings.allowControlEnabled}
            onToggle={handleControlToggle}
          />
        )}

        {/* Input Permission Error */}
        {inputPermissionError && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#92400e',
            }}
          >
            <strong>Permission Required:</strong> {inputPermissionError.includes('Accessibility') 
              ? 'Accessibility permission is needed for remote control. Enable it in System Settings > Privacy & Security > Accessibility for this app.'
              : inputPermissionError}
            <div style={{ marginTop: '0.75rem' }}>
              <button
                onClick={() => void handleOpenPermissionSettings('accessibility')}
                style={{
                  padding: '0.5rem 0.75rem',
                  backgroundColor: '#92400e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                Open Accessibility Settings
              </button>
            </div>
          </div>
        )}

        {/* Run Panel */}
        {isSignedIn && (
          <div style={{ marginTop: '1.5rem' }}>
            {pendingToolProposal && !workspaceState.configured && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  background: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  color: '#92400e',
                }}
              >
                Workspace not configured. Choose a folder in Settings.
              </div>
            )}
            <RunPanel 
              run={activeRun} 
              onCancel={handleCancelRun}
              // AI Assist props
              isAiAssist={isAiAssist}
              aiState={aiState?.status}
              currentProposal={currentProposal}
              currentApproval={pendingAiProposalApproval}
              actionCount={activeRun?.actionCount}
              maxActions={activeRun?.constraints?.maxActions}
              onApproveAction={handleAiApproveAction}
              onRejectAction={handleAiRejectAction}
              onApproveTool={handleAiApproveTool}
              onRejectTool={handleAiRejectTool}
              onUserResponse={handleAiUserResponse}
              onStopAi={handleStopAi}
              toolHistory={activeToolHistory}
              workspaceConfigured={workspaceState.configured}
            />
          </div>
        )}

        <p style={{ marginTop: '2rem', color: '#666', maxWidth: '600px' }}>
          {isSignedIn
            ? 'This desktop is connected directly to your account. Live runs, approvals, and device controls appear here.'
            : 'Sign in from this desktop to connect it to your account and unlock local runs, approvals, and device controls.'}
        </p>
        
        {isSignedIn && isAiAssist && (
          <p style={{ color: '#8b5cf6', maxWidth: '600px' }}>
            🤖 <strong>AI Assist Mode:</strong> The AI will analyze your screen and propose actions one at a time.
            Every action requires your explicit approval before execution.
          </p>
        )}
      </div>

      {/* Chat Overlay */}
      {isSignedIn && (
        <ChatOverlay
          messages={messages}
          status={status}
          onSendMessage={handleSendMessage}
        />
      )}

      {/* Approval Modal */}
      {pendingApproval && (
        <ApprovalModal
          approval={pendingApproval.approval}
          onDecision={handleApprovalDecision}
        />
      )}

      {/* Action Approval Modal */}
      {pendingControlApproval && pendingControlPayload && (
        <ActionApprovalModal
          approval={pendingControlApproval}
          actionId={pendingControlPayload.actionId}
          action={pendingControlPayload.action}
          onApprove={handleActionApprove}
          onDeny={handleActionDeny}
        />
      )}

      {pendingToolProposal && pendingToolApproval && workspaceState.configured && (
        <ToolApprovalModal
          approval={pendingToolApproval}
          toolCall={pendingToolProposal.toolCall}
          rationale={pendingToolProposal.rationale}
          onApprove={handleAiApproveTool}
          onDeny={handleAiRejectTool}
        />
      )}

      {/* AI Engineering System - Agent Workflow */}
      {agentWorkflowOpen && (
        <AgentWorkflow
          isOpen={agentWorkflowOpen}
          onClose={() => setAgentWorkflowOpen(false)}
          workspaceName={workspaceState.rootName || 'workspace'}
        />
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          localSettings={localSettings}
          autostartSupported={autostartSupported}
          autostartBusy={autostartBusy}
          autostartError={autostartError}
          onStartMinimizedChange={handleStartMinimizedChange}
          onAutostartChange={handleAutostartChange}
          onScreenPreviewToggle={handleScreenPreviewToggle}
          onAllowControlToggle={handleControlToggle}
          onWorkspaceChange={handleWorkspaceChange}
          apiHttpBase={runtimeConfig?.httpBase || null}
          runtimeConfigError={runtimeConfigError}
          permissionStatus={permissionStatus}
          permissionStatusBusy={permissionStatusBusy}
          onRefreshPermissionStatus={refreshPermissionStatus}
          onOpenPermissionSettings={handleOpenPermissionSettings}
          permissionHintTarget={permissionHintTarget}
          permissionHintMessage={permissionHintMessage}
          onExportDiagnostics={handleExportDiagnostics}
          diagnosticsStatus={diagnosticsStatus}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connecting: '#f59e0b',
    connected: '#10b981',
    disconnected: '#6b7280',
    error: '#ef4444',
  };

  const labels: Record<ConnectionStatus, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    error: 'Error',
  };

  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '14px',
        fontWeight: 500,
        color: colors[status],
      }}
    >
      <span
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: colors[status],
          animation: status === 'connecting' ? 'pulse 1s infinite' : undefined,
        }}
      />
      {labels[status]}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </span>
  );
}

export default App;
