import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Effect, EffectState, getCurrentWindow } from '@tauri-apps/api/window';
import type { ServerMessage, ServerChatMessage, RunWithSteps, ApprovalRequest, InputAction, AgentProposal } from '@ai-operator/shared';
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
import { hasLlMProviderConfigured, type LocalToolEvent } from './lib/aiAssist.js';
import {
  createAssistantEngine,
  DEFAULT_ASSISTANT_ENGINE_ID,
  getAssistantEngineCatalog,
  type AssistantEngineHandle,
  type AssistantEngineId,
  type AssistantEngineState,
} from './lib/assistantEngine.js';
import {
  DEFAULT_LLM_PROVIDER,
  getLlmDefaults,
  getLlmProviderLabel,
  mergeLlmSettings,
  type LlmSettings,
} from './lib/llmConfig.js';
import { desktopRuntimeConfig } from './lib/desktopRuntimeConfig.js';
import { logoutDesktopSession, startDesktopSignIn } from './lib/desktopAuth.js';
import { getDesktopAccount, revokeDesktopDevice, type DesktopAccountSnapshot } from './lib/desktopAccount.js';
import { createDesktopRun, getDesktopTaskBootstrap, type DesktopTaskBootstrap } from './lib/desktopTasks.js';
import {
  createAssistantTaskConfirmation,
  buildAssistantOpeningGoal,
  ensureAssistantRunForMessage,
  getAssistantDisplayGoal,
  interpretAssistantTaskConfirmationResponse,
  isAssistantOpeningGoal,
  isAssistantRunActive,
  shouldConfirmAssistantTaskStart,
  type AssistantTaskConfirmation,
} from './lib/chatTaskFlow.js';
import {
  enableLocalAiVisionBoost,
  getLocalAiHardwareProfile,
  getLocalAiInstallProgress,
  getLocalAiRecommendedTier,
  getLocalAiStatus,
  isLocalAiInstallActive,
  resolveManagedLocalLlmBinding,
  resolveManagedLocalTaskBinding,
  startLocalAiInstall,
  type LocalAiHardwareProfile,
  type LocalAiInstallProgress,
  type LocalAiRuntimeStatus,
  type LocalAiTier,
  type LocalAiTierRecommendation,
} from './lib/localAi.js';
import {
  canStartManagedLocalTask,
  getLocalAiPlanPolicy,
  getTodayUsageKey,
  readLocalAiTaskUsage,
  recordManagedLocalTaskStart,
  type LocalAiTaskUsage,
} from './lib/localPlan.js';
import {
  enterOverlayMode,
  exitOverlayMode,
  getOverlayModeStatus,
  type OverlayModeStatus,
} from './lib/overlayMode.js';
import {
  getPermissionBannerMessage,
  getPermissionSettingsButtonLabel,
  getPermissionStatus,
  openPermissionSettings,
  type NativePermissionStatus,
  type PermissionTarget,
} from './lib/permissions.js';
import { getWorkspaceState, type LocalWorkspaceState } from './lib/workspace.js';
import { getSettings, setSetting, subscribe, updateSettings, type LocalSettingsState } from './lib/localSettings.js';
import {
  evaluateDesktopTaskReadiness,
  getDesktopControlExecutionBlocker,
} from './lib/taskReadiness.js';
import {
  buildGorkhContextBlock,
  type GorkhInstallStage,
  type GorkhLocalAiTier,
  type GorkhPermissionStatus,
  type GorkhGpuClass,
} from './lib/gorkhContext.js';
import { ChatOverlay } from './components/ChatOverlay.js';
import { RunPanel } from './components/RunPanel.js';
import { ApprovalModal } from './components/ApprovalModal.js';
import { ScreenPanel } from './components/ScreenPanel.js';
import { ControlPanel } from './components/ControlPanel.js';
import { ActionApprovalModal } from './components/ActionApprovalModal.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ToolApprovalModal } from './components/ToolApprovalModal.js';
import { FreeAiSetupCard } from './components/FreeAiSetupCard.js';
import { BrandWordmark } from './components/BrandWordmark.js';
import { ActiveOverlayShell } from './components/ActiveOverlayShell.js';
import { OverlayController } from './components/OverlayController.js';
import { OverlayDetailsPanel } from './components/OverlayDetailsPanel.js';

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
const DESKTOP_APP_VERSION = __GORKH_DESKTOP_VERSION__;

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

function getTrayNoticeMessage(platform: ReturnType<typeof detectPlatform>): string {
  if (platform === 'macos') {
    return 'GORKH is still running in the menu bar. Choose Quit GORKH from the menu bar icon to fully exit.';
  }

  return 'GORKH is still running in the tray. Choose Quit GORKH from the tray icon to fully exit.';
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

function createChatItem(role: ChatItem['role'], text: string, timestamp: number = Date.now()): ChatItem {
  return {
    id: `${timestamp}-${Math.random()}`,
    role,
    text,
    timestamp,
  };
}

function App() {
  const platform = detectPlatform();
  const [client, setClient] = useState<WsClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(desktopRuntimeConfig.ok ? 'disconnected' : 'error');
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [pendingTaskConfirmation, setPendingTaskConfirmation] = useState<AssistantTaskConfirmation | null>(null);
  const [pendingTaskConfirmationBusy, setPendingTaskConfirmationBusy] = useState(false);
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
  const [desktopOverviewRefreshNonce, setDesktopOverviewRefreshNonce] = useState(0);
  const [deviceRevokeBusyId, setDeviceRevokeBusyId] = useState<string | null>(null);
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
  const assistantEngineCatalog = getAssistantEngineCatalog();
  const [assistantEngineId, setAssistantEngineId] = useState<AssistantEngineId>(DEFAULT_ASSISTANT_ENGINE_ID);
  const [assistantEngine, setAssistantEngine] = useState<AssistantEngineHandle | null>(null);
  const assistantEngineRef = useRef<AssistantEngineHandle | null>(null);
  const [aiState, setAiState] = useState<AssistantEngineState | null>(null);
  const [currentProposal, setCurrentProposal] = useState<AgentProposal | undefined>(undefined);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(() => getLlmDefaults(DEFAULT_LLM_PROVIDER));
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [providerCheckBusy, setProviderCheckBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [primaryDisplayId, setPrimaryDisplayId] = useState<string>('display-0');
  const [workspaceState, setWorkspaceState] = useState<LocalWorkspaceState>({ configured: false });
  const [toolHistoryByRun, setToolHistoryByRun] = useState<Record<string, LocalToolEvent[]>>({});
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiRuntimeStatus | null>(null);
  const [localAiInstallProgress, setLocalAiInstallProgress] = useState<LocalAiInstallProgress | null>(null);
  const [localAiHardwareProfile, setLocalAiHardwareProfile] = useState<LocalAiHardwareProfile | null>(null);
  const [localAiRecommendation, setLocalAiRecommendation] = useState<LocalAiTierRecommendation | null>(null);
  const [localAiBusy, setLocalAiBusy] = useState(false);
  const [localAiActionBusy, setLocalAiActionBusy] = useState(false);
  const [localAiError, setLocalAiError] = useState<string | null>(null);
  const [localAiTaskUsage, setLocalAiTaskUsage] = useState<LocalAiTaskUsage>(() => ({
    dayKey: getTodayUsageKey(),
    tasksStarted: 0,
  }));
  const [overlayModeStatus, setOverlayModeStatus] = useState<OverlayModeStatus | null>(null);
  const [overlayDetailsOpen, setOverlayDetailsOpen] = useState(false);
  const [visionBoostRequested, setVisionBoostRequested] = useState(false);
  const controlEnabledRef = useRef(localSettings.allowControlEnabled);
  const workspaceConfiguredRef = useRef(workspaceState.configured);
  const assistantAutoStartAttemptedRef = useRef(false);
  const assistantAutoStartInFlightRef = useRef(false);
  const assistantStartingRunIdRef = useRef<string | null>(null);
  const assistantConsumedWarmupRunIdsRef = useRef(new Set<string>());
  const clientRef = useRef<WsClient | null>(null);
  const controlApprovalPayloadsRef = useRef(new Map<string, PendingControlApprovalPayload>());
  const proposalApprovalPayloadsRef = useRef(new Map<string, PendingProposalPayload>());
  const runtimeConfig = desktopRuntimeConfig.ok ? desktopRuntimeConfig.config : null;
  const runtimeConfigError = desktopRuntimeConfig.ok ? null : desktopRuntimeConfig.message;
  const isSignedIn = Boolean(sessionDeviceToken);

  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background;
    const previousBodyBackground = document.body.style.background;
    const targetBackground = platform === 'macos' ? 'transparent' : '#eef2f7';

    document.documentElement.style.background = targetBackground;
    document.body.style.background = targetBackground;

    return () => {
      document.documentElement.style.background = previousHtmlBackground;
      document.body.style.background = previousBodyBackground;
    };
  }, [platform]);

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

  const refreshLocalAiState = useCallback(async () => {
    setLocalAiBusy(true);
    setLocalAiError(null);
    try {
      const [statusPayload, progressPayload, hardwarePayload, recommendationPayload] = await Promise.all([
        getLocalAiStatus(),
        getLocalAiInstallProgress(),
        getLocalAiHardwareProfile(),
        getLocalAiRecommendedTier(),
      ]);
      setLocalAiStatus(statusPayload);
      setLocalAiInstallProgress(progressPayload);
      setLocalAiHardwareProfile(hardwarePayload);
      setLocalAiRecommendation(recommendationPayload);
      const configured = await hasLlMProviderConfigured(llmSettings.provider);
      setProviderConfigured(configured);
    } catch (err) {
      setLocalAiError(err instanceof Error ? err.message : 'Failed to load Free AI status');
    } finally {
      setLocalAiBusy(false);
    }
  }, [llmSettings.provider]);

  const refreshProviderConfigured = useCallback(async () => {
    setProviderCheckBusy(true);
    try {
      const configured = await hasLlMProviderConfigured(llmSettings.provider);
      setProviderConfigured(configured);
    } catch {
      setProviderConfigured(false);
    } finally {
      setProviderCheckBusy(false);
    }
  }, [llmSettings.provider]);

  const notePermissionIssue = useCallback((target: PermissionTarget, message: string) => {
    setPermissionHintTarget(target);
    setPermissionHintMessage(message);
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  const noteControlExecutionBlocker = useCallback((blocker: { id: string; detail: string }) => {
    setInputPermissionError(blocker.detail);
    if (blocker.id === 'accessibility-permission') {
      notePermissionIssue('accessibility', blocker.detail);
    }
  }, [notePermissionIssue]);

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
      assistantEngineRef.current?.dismissPendingProposal(
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
    assistantEngineRef.current = assistantEngine;
  }, [assistantEngine]);

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
    if (isSignedIn) {
      return;
    }

    setPendingTaskConfirmation(null);
    setPendingTaskConfirmationBusy(false);
    assistantAutoStartAttemptedRef.current = false;
    assistantAutoStartInFlightRef.current = false;
    assistantStartingRunIdRef.current = null;
    assistantConsumedWarmupRunIdsRef.current.clear();
  }, [isSignedIn]);

  useEffect(() => {
    persistLlmSettings(llmSettings);
  }, [llmSettings]);

  useEffect(() => {
    let cancelled = false;

    void refreshProviderConfigured().catch(() => {
      if (!cancelled) {
        setProviderConfigured(false);
        setProviderCheckBusy(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshProviderConfigured, localAiStatus?.runtimeRunning]);

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
    if (!isSignedIn) {
      setLocalAiStatus(null);
      setLocalAiInstallProgress(null);
      setLocalAiHardwareProfile(null);
      setLocalAiRecommendation(null);
      setLocalAiBusy(false);
      setLocalAiActionBusy(false);
      setLocalAiError(null);
      setLocalAiTaskUsage({
        dayKey: getTodayUsageKey(),
        tasksStarted: 0,
      });
      setVisionBoostRequested(false);
      return;
    }

    setLocalAiTaskUsage(readLocalAiTaskUsage(window.localStorage));
    void refreshLocalAiState();
  }, [isSignedIn, refreshLocalAiState]);

  useEffect(() => {
    if (!isSignedIn) {
      return undefined;
    }

    const currentStage = localAiInstallProgress?.stage ?? localAiStatus?.installStage;
    if (!isLocalAiInstallActive(currentStage)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshLocalAiState();
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSignedIn, localAiInstallProgress?.stage, localAiStatus?.installStage, refreshLocalAiState]);

  useEffect(() => {
    if (currentProposal?.kind !== 'ask_user') {
      return;
    }

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'agent' && last.text === currentProposal.question) {
        return prev;
      }
      return [...prev, createChatItem('agent', currentProposal.question)];
    });
  }, [currentProposal]);

  useEffect(() => {
    if (currentProposal?.kind !== 'done') {
      return;
    }

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'agent' && last.text === currentProposal.summary) {
        return prev;
      }
      return [...prev, createChatItem('agent', currentProposal.summary)];
    });
  }, [currentProposal]);

  useEffect(() => {
    if (llmSettings.provider !== DEFAULT_LLM_PROVIDER) {
      return;
    }

    const binding = resolveManagedLocalLlmBinding(localAiStatus, localAiRecommendation);
    if (llmSettings.baseUrl === binding.baseUrl && llmSettings.model === binding.model) {
      return;
    }

    setLlmSettings((current) => {
      if (current.provider !== DEFAULT_LLM_PROVIDER) {
        return current;
      }
      if (current.baseUrl === binding.baseUrl && current.model === binding.model) {
        return current;
      }
      return {
        ...current,
        baseUrl: binding.baseUrl,
        model: binding.model,
      };
    });
  }, [
    llmSettings.baseUrl,
    llmSettings.model,
    llmSettings.provider,
    localAiRecommendation,
    localAiStatus,
  ]);

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
          const engine = assistantEngineRef.current;
          if (!engine) {
            return;
          }

          if (engine.isPaused()) {
            engine.resume();
          } else {
            engine.pause();
          }
          setAiState(engine.getState());
        }),
        listen('tray.show', () => {
          setWindowVisible(true);
        }),
        listen('tray.hide', () => {
          setWindowVisible(false);
        }),
        listen('tray.tip', () => {
          setTrayNotice(getTrayNoticeMessage(platform));
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
  }, [platform]);

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
        platform,
        appVersion: DESKTOP_APP_VERSION,
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
          assistantStartingRunIdRef.current = null;
          assistantEngineRef.current?.stop('Run canceled');
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
            void startAssistantEngine(runId, goal);
          }
          return { ok: true as const };
        },
      });

      setClient(wsClient);
      wsClient.connect(runtimeConfig.wsUrl);

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
      assistantStartingRunIdRef.current = null;
      assistantEngineRef.current?.stop('Component unmounting');
    };
  }, [platform]);

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
  }, [authState, runtimeConfig, sessionDeviceToken, status, desktopOverviewRefreshNonce]);

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
  }, [authState, runtimeConfig, sessionDeviceToken, status, desktopOverviewRefreshNonce]);

  useEffect(() => {
    let cancelled = false;

    void getOverlayModeStatus()
      .then((next) => {
        if (!cancelled) {
          setOverlayModeStatus(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setOverlayModeStatus({
            active: false,
            supported: false,
            lastError: err instanceof Error ? err.message : 'Overlay mode status unavailable',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const shouldEnterOverlay = Boolean(aiState?.isRunning);

    if (overlayModeStatus?.supported === false) {
      return;
    }

    const syncOverlayMode = async () => {
      try {
        const next = shouldEnterOverlay
          ? await enterOverlayMode()
          : await exitOverlayMode();
        if (!cancelled) {
          setOverlayModeStatus(next);
        }
      } catch (err) {
        if (!cancelled) {
          setOverlayModeStatus((current) => ({
            active: current?.active ?? false,
            supported: current?.supported ?? false,
            lastError: err instanceof Error ? err.message : 'Overlay mode sync failed',
          }));
        }
      }
    };

    void syncOverlayMode();

    return () => {
      cancelled = true;
    };
  }, [aiState?.isRunning, overlayModeStatus?.supported]);

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

  // Start the unified assistant engine for the current run
  const startAssistantEngine = useCallback(async (runId: string, goal: string) => {
    if (!client) return;

    if (assistantStartingRunIdRef.current === runId) {
      return;
    }

    if (
      assistantStartingRunIdRef.current &&
      assistantStartingRunIdRef.current !== runId &&
      assistantEngineRef.current
    ) {
      assistantEngineRef.current.stop('Switching assistant runs');
      setAssistantEngine(null);
      setAiState(null);
      setCurrentProposal(undefined);
    }

    assistantStartingRunIdRef.current = runId;

    const effectiveSettings: LlmSettings = llmSettings.provider === DEFAULT_LLM_PROVIDER
      ? (() => {
          const binding = resolveManagedLocalTaskBinding(localAiStatus, localAiRecommendation, goal);
          return {
            ...llmSettings,
            baseUrl: binding.baseUrl,
            model: binding.model,
          };
        })()
      : llmSettings;
    const providerReady = await hasLlMProviderConfigured(effectiveSettings.provider);

    if (!providerReady) {
      client.sendRunLog(runId, 'Assistant engine cannot start: provider is not configured', 'error');
      client.sendRunUpdate(runId, 'failed', 'LLM_NOT_CONFIGURED');
      setSettingsOpen(true);
      return;
    }

    // Build structured GORKH app context for LLM grounding.
    const gorkhAppContext = buildGorkhContextBlock({
      authState,
      provider: llmSettings.provider,
      providerConfigured,
      freeAi: localAiStatus
        ? {
            installStage: localAiStatus.installStage as GorkhInstallStage,
            runtimeRunning: localAiStatus.runtimeRunning,
            selectedTier: localAiStatus.selectedTier as GorkhLocalAiTier | null,
            selectedModel: localAiStatus.selectedModel,
            externalServiceDetected: localAiStatus.externalServiceDetected,
            lastError: localAiStatus.lastError,
          }
        : null,
      permissions: {
        screenRecordingStatus: permissionStatus.screenRecording as GorkhPermissionStatus,
        accessibilityStatus: permissionStatus.accessibility as GorkhPermissionStatus,
        screenPreviewEnabled: localSettings.screenPreviewEnabled,
        controlEnabled: localSettings.allowControlEnabled,
      },
      workspaceConfigured: workspaceState.configured,
      workspaceRootName: workspaceState.rootName ?? null,
      hardware: localAiHardwareProfile
        ? {
            gpuClass: localAiHardwareProfile.gpuClass as GorkhGpuClass,
            ramGb: localAiHardwareProfile.ramBytes !== null
              ? Math.round(localAiHardwareProfile.ramBytes / (1024 * 1024 * 1024))
              : null,
          }
        : null,
    });

    const engine = createAssistantEngine(assistantEngineId, {
      wsClient: client,
      deviceId,
      runId,
      goal,
      constraints: { maxActions: 20, maxRuntimeMinutes: 20 },
      displayId: primaryDisplayId,
      appContext: gorkhAppContext ?? undefined,
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
        console.error('[App] Assistant engine error:', error);
        setMessages((prev) => [...prev, createChatItem('agent', error)]);
      },
    });

    setAssistantEngine(engine);
    const started = await engine.start(effectiveSettings);
    
    if (!started) {
      if (assistantStartingRunIdRef.current === runId) {
        assistantStartingRunIdRef.current = null;
      }
      setAssistantEngine(null);
    }
  }, [
    assistantEngineId,
    client,
    deviceId,
    llmSettings,
    localAiRecommendation,
    localAiStatus,
    primaryDisplayId,
  ]);

  // Handle server messages
  const handleServerMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'server.chat.message': {
        const payload = (message as ServerChatMessage).payload;
        const msg = payload.message;
        setMessages((prev) => [
          ...prev,
          createChatItem(msg.role, msg.text, msg.createdAt),
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

  const dispatchConfirmedAssistantTask = useCallback(async (trimmed: string): Promise<boolean> => {
    if (!client || !runtimeConfig || !sessionDeviceToken) {
      setMessages((prev) => [
        ...prev,
        createChatItem('agent', 'Sign in and reconnect this desktop before asking the assistant to work.'),
      ]);
      return false;
    }

    const startingNewTask = !activeRun || !['queued', 'running', 'waiting_for_user'].includes(activeRun.status);
    const isWarmupRun = Boolean(
      activeRun
      && llmSettings.provider === DEFAULT_LLM_PROVIDER
      && isAssistantOpeningGoal(activeRun.goal)
      && !assistantConsumedWarmupRunIdsRef.current.has(activeRun.runId)
    );
    const canUseWarmupRun = Boolean(isWarmupRun && assistantEngine && aiState?.status === 'asking_user');
    const shouldReplaceWarmupRun = Boolean(isWarmupRun && !canUseWarmupRun);
    const shouldCountManagedLocalTaskStart = startingNewTask || isWarmupRun;

    try {
      let runToReuse = activeRun;
      if (shouldReplaceWarmupRun && activeRun) {
        assistantStartingRunIdRef.current = null;
        assistantEngine?.stop('Replacing warmup session with a direct task run');
        setAssistantEngine(null);
        setAiState(null);
        setCurrentProposal(undefined);
        client.sendRunCancel(activeRun.runId);
        runToReuse = null;
      }

      const run = await ensureAssistantRunForMessage({
        message: trimmed,
        activeRun: runToReuse,
        runtimeConfig,
        deviceToken: sessionDeviceToken,
      });
      const displayRun = isWarmupRun
        ? {
            ...run,
            goal: trimmed,
          }
        : run;

      setActiveRun(displayRun);
      setRecentRuns((currentRuns) => upsertRunHistory(currentRuns, displayRun));
      if (llmSettings.provider === DEFAULT_LLM_PROVIDER && shouldCountManagedLocalTaskStart) {
        setLocalAiTaskUsage(recordManagedLocalTaskStart(window.localStorage));
        if (isWarmupRun && activeRun) {
          assistantConsumedWarmupRunIdsRef.current.add(activeRun.runId);
        }
      }

      const sent = client.sendChat(trimmed, run.runId);
      if (!sent) {
        setMessages((prev) => [
          ...prev,
          createChatItem('agent', 'The desktop disconnected before the assistant could start. Reconnect and try again.'),
        ]);
        return false;
      }

      if (canUseWarmupRun && assistantEngine) {
        assistantEngine.userResponse(trimmed);
      }

      return true;
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        createChatItem(
          'agent',
          err instanceof Error ? err.message : 'The assistant could not start the task from chat.'
        ),
      ]);
      return false;
    }
  }, [
    activeRun,
    assistantEngine,
    aiState,
    client,
    desktopBootstrap?.billing,
    desktopAccount?.billing,
    llmSettings.provider,
    runtimeConfig,
    sessionDeviceToken,
  ]);

  const handleCancelPendingTask = useCallback(() => {
    if (!pendingTaskConfirmation) {
      return;
    }
    setPendingTaskConfirmation(null);
    setPendingTaskConfirmationBusy(false);
    setMessages((prev) => [
      ...prev,
      createChatItem('agent', 'Okay, I will not start that task. Send a new request when you are ready.'),
    ]);
  }, [pendingTaskConfirmation]);

  const handleConfirmPendingTask = useCallback(() => {
    if (!pendingTaskConfirmation || pendingTaskConfirmationBusy) {
      return;
    }

    setPendingTaskConfirmationBusy(true);
    void dispatchConfirmedAssistantTask(pendingTaskConfirmation.goal)
      .finally(() => {
        setPendingTaskConfirmation(null);
        setPendingTaskConfirmationBusy(false);
      });
  }, [dispatchConfirmedAssistantTask, pendingTaskConfirmation, pendingTaskConfirmationBusy]);

  // Handle sending a chat message
  const handleSendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const confirmationAction = pendingTaskConfirmation && !pendingTaskConfirmationBusy
        ? interpretAssistantTaskConfirmationResponse(trimmed)
        : null;

      setMessages((prev) => [
        ...prev,
        createChatItem('user', trimmed),
      ]);

      if (confirmationAction === 'confirm') {
        void handleConfirmPendingTask();
        return;
      }

      if (confirmationAction === 'cancel') {
        handleCancelPendingTask();
        return;
      }

      setPendingTaskConfirmation(null);
      setPendingTaskConfirmationBusy(false);

      if (!client || !runtimeConfig || !sessionDeviceToken) {
        setMessages((prev) => [
          ...prev,
          createChatItem('agent', 'Sign in and reconnect this desktop before asking the assistant to work.'),
        ]);
        return;
      }

      const assistantReadiness = evaluateDesktopTaskReadiness({
        mode: 'ai_assist',
        subscriptionStatus: desktopBootstrap?.billing.subscriptionStatus ?? 'inactive',
        platform,
        permissionStatus,
        localSettings,
        workspaceConfigured: workspaceState.configured,
        providerConfigured,
        isManagedLocalProvider: llmSettings.provider === DEFAULT_LLM_PROVIDER,
        requireControl: false,
      });

      if (!assistantReadiness.ready) {
        const setupMessage = llmSettings.provider === DEFAULT_LLM_PROVIDER && !providerConfigured
          ? localAiInstallProgress?.message
              || localAiRecommendation?.reason
              || 'Set up Free AI first so the local assistant can prepare this desktop.'
          : assistantReadiness.requiredSetup[0]?.detail || 'This desktop is not ready to start assistant work yet.';
        setMessages((prev) => [
          ...prev,
          createChatItem(
            'agent',
            setupMessage
          ),
        ]);
        return;
      }

      const localPlanPolicy = getLocalAiPlanPolicy(desktopBootstrap?.billing ?? desktopAccount?.billing);
      const startingNewTask = !activeRun || !['queued', 'running', 'waiting_for_user'].includes(activeRun.status);
      const isWarmupRun = Boolean(
        activeRun
        && llmSettings.provider === DEFAULT_LLM_PROVIDER
        && isAssistantOpeningGoal(activeRun.goal)
        && !assistantConsumedWarmupRunIdsRef.current.has(activeRun.runId)
      );
      const shouldCountManagedLocalTaskStart = startingNewTask || isWarmupRun;

      if (llmSettings.provider === DEFAULT_LLM_PROVIDER) {
        const localTaskBinding = resolveManagedLocalTaskBinding(localAiStatus, localAiRecommendation, trimmed);
        if (localTaskBinding.requiresVisionBoost) {
          setVisionBoostRequested(true);
          setMessages((prev) => [
            ...prev,
            createChatItem(
              'agent',
              `This task likely needs screenshot understanding. Enable Vision Boost to let the local assistant inspect the screen with ${localTaskBinding.visionModel}.`
            ),
          ]);
          return;
        }

        if (shouldCountManagedLocalTaskStart) {
          const usage = readLocalAiTaskUsage(window.localStorage);
          const taskAllowance = canStartManagedLocalTask(localPlanPolicy, usage);
          if (!taskAllowance.allowed) {
            setMessages((prev) => [
              ...prev,
              createChatItem('agent', taskAllowance.reason || 'Free local task limit reached for today.'),
            ]);
            return;
          }
        }
      }

      if (shouldConfirmAssistantTaskStart(activeRun)) {
        const confirmation = createAssistantTaskConfirmation(trimmed);
        setPendingTaskConfirmation(confirmation);
        setMessages((prev) => [
          ...prev,
          createChatItem('agent', confirmation.prompt),
        ]);
        return;
      }

      void dispatchConfirmedAssistantTask(trimmed);
    },
    [
      activeRun,
      client,
      desktopBootstrap?.billing.subscriptionStatus,
      desktopBootstrap?.billing,
      desktopAccount?.billing,
      dispatchConfirmedAssistantTask,
      handleCancelPendingTask,
      handleConfirmPendingTask,
      localSettings,
      pendingTaskConfirmation,
      pendingTaskConfirmationBusy,
      permissionStatus,
      providerConfigured,
      runtimeConfig,
      sessionDeviceToken,
      workspaceState.configured,
      llmSettings.provider,
      localAiStatus,
      localAiInstallProgress?.message,
      localAiRecommendation?.reason,
      localAiRecommendation,
    ]
  );

  const handleStartFreeAi = useCallback(async (tier: LocalAiTier) => {
    setLocalAiActionBusy(true);
    setLocalAiError(null);
    try {
      const progress = await startLocalAiInstall(tier);
      setLocalAiInstallProgress(progress);
      await refreshLocalAiState();
      setLlmSettings((current) => mergeLlmSettings(current.provider === DEFAULT_LLM_PROVIDER ? current : getLlmDefaults(DEFAULT_LLM_PROVIDER)));
      setDiagnosticsStatus('Free AI setup started for this desktop.');
    } catch (err) {
      setLocalAiError(err instanceof Error ? err.message : 'Failed to start Free AI setup');
    } finally {
      setLocalAiActionBusy(false);
    }
  }, [refreshLocalAiState]);

  const handleEnableVisionBoost = useCallback(async () => {
    setLocalAiActionBusy(true);
    setLocalAiError(null);
    try {
      const localPlanPolicy = getLocalAiPlanPolicy(desktopBootstrap?.billing ?? desktopAccount?.billing);
      if (!localPlanPolicy.visionBoostIncluded) {
        throw new Error('Vision Boost is included with Plus. Free local AI stays on lightweight text models.');
      }
      const progress = await enableLocalAiVisionBoost();
      setLocalAiInstallProgress(progress);
      await refreshLocalAiState();
      setVisionBoostRequested(false);
      setDiagnosticsStatus('Vision Boost setup started for this desktop.');
    } catch (err) {
      setLocalAiError(err instanceof Error ? err.message : 'Failed to enable Vision Boost');
    } finally {
      setLocalAiActionBusy(false);
    }
  }, [desktopBootstrap?.billing, desktopAccount?.billing, refreshLocalAiState]);

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
      client.disconnect();
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

    if (runtimeConfig) {
      try {
        await logoutDesktopSession({
          runtimeConfig,
          deviceToken: currentToken,
        });
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Desktop sign-out failed');
        setAuthState('signed_in');
        return;
      }
    }

    try {
      await clearStoredDeviceToken(deviceId);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Desktop sign-out failed');
      setAuthState('signed_in');
      return;
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
    setRecentRuns([]);
    setActiveRun(null);
    setPendingApproval(null);
    setMessages([]);
    setPendingTaskConfirmation(null);
    setPendingTaskConfirmationBusy(false);
    setCurrentProposal(undefined);
    setToolHistoryByRun({});
    setInputPermissionError(null);
    approvalController.cancelAllPending('Desktop signed out');
    controlApprovalPayloadsRef.current.clear();
    proposalApprovalPayloadsRef.current.clear();
    assistantStartingRunIdRef.current = null;
    assistantEngineRef.current?.stop('Desktop signed out');
    setAssistantEngine(null);
    setAiState(null);
    setVisionBoostRequested(false);
  }, [client, deviceId, runtimeConfig, sessionDeviceToken]);

  const handleSelectRecentRun = useCallback((runId: string) => {
    const selected = recentRuns.find((run) => run.runId === runId);
    if (selected) {
      setActiveRun(selected);
    }
  }, [recentRuns]);

  const handleRefreshDesktopOverview = useCallback(() => {
    setDesktopOverviewRefreshNonce((current) => current + 1);
  }, []);

  const handleRevokeDesktopDevice = useCallback(async (targetDeviceId: string) => {
    if (!runtimeConfig || !sessionDeviceToken) {
      setDesktopAccountError('Desktop sign-in is required before managing signed-in desktops.');
      return;
    }

    setDeviceRevokeBusyId(targetDeviceId);
    setDesktopAccountError(null);

    try {
      await revokeDesktopDevice(runtimeConfig, sessionDeviceToken, targetDeviceId);
      const refreshed = await getDesktopAccount(runtimeConfig, sessionDeviceToken);
      setDesktopAccount(refreshed);
    } catch (err) {
      setDesktopAccountError(err instanceof Error ? err.message : 'Failed to sign out the selected desktop');
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
    assistantStartingRunIdRef.current = null;
    assistantEngine?.stop('User canceled');
    client?.sendRunCancel(activeRun.runId);
  }, [client, activeRun, assistantEngine]);

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

    const controlBlocker = getDesktopControlExecutionBlocker({
      platform,
      permissionStatus,
      localSettings: {
        allowControlEnabled: localSettings.allowControlEnabled,
      },
    });
    if (controlBlocker) {
      noteControlExecutionBlocker(controlBlocker);
      return;
    }

    approvalController.approve(approval.id);
    approvalController.markExecuting(approval.id);
    activeClient.sendActionAck(payload.actionId, 'approved');

    const result = await executeAction(payload.action, primaryDisplayId);
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
  }, [approvalItems, localSettings.allowControlEnabled, noteControlExecutionBlocker, notePermissionIssue, permissionStatus, platform]);

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
      assistantEngineRef.current?.pause();
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
    if (!approval || !assistantEngineRef.current) {
      return;
    }

    const controlBlocker = getDesktopControlExecutionBlocker({
      platform,
      permissionStatus,
      localSettings: {
        allowControlEnabled: localSettings.allowControlEnabled,
      },
    });
    if (controlBlocker) {
      noteControlExecutionBlocker(controlBlocker);
      return;
    }

    approvalController.approve(approval.id);
    approvalController.markExecuting(approval.id);
    const result = await assistantEngineRef.current.approveAction();
    if (result.ok) {
      approvalController.markExecuted(approval.id);
      return;
    }

    if (result.error && (result.error.includes('Accessibility') || result.error.includes('permission'))) {
      notePermissionIssue('accessibility', result.error);
    }
    approvalController.markFailed(approval.id, 'EXECUTION_FAILED');
  }, [approvalItems, localSettings.allowControlEnabled, noteControlExecutionBlocker, notePermissionIssue, permissionStatus, platform]);

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

    if (!assistantEngineRef.current) {
      return;
    }

    approvalController.approve(approval.id);
    approvalController.markExecuting(approval.id);
    const result = await assistantEngineRef.current.approveTool();
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
    assistantEngine?.userResponse(response);
  }, [assistantEngine]);

  const handleStopAi = useCallback(() => {
    approvalController.cancelAllPending('AI Assist stopped', (item) =>
      item.kind === 'ai_proposal' || item.kind === 'tool_call'
    );
    setPendingTaskConfirmation(null);
    setPendingTaskConfirmationBusy(false);
    assistantStartingRunIdRef.current = null;
    assistantEngine?.stop('User stopped');
    if (activeRun) {
      client?.sendRunUpdate(activeRun.runId, 'canceled', 'AI Assist stopped by user');
      setActiveRun((prev) => (prev ? { ...prev, status: 'canceled' } : prev));
    }
    setAssistantEngine(null);
    setAiState(null);
    setCurrentProposal(undefined);
    void exitOverlayMode()
      .then((next) => {
        setOverlayModeStatus(next);
      })
      .catch((err) => {
        console.error('[App] Failed to exit overlay mode after stop:', err);
      });
  }, [assistantEngine, activeRun, client]);

  const handleStopAll = useCallback(() => {
    const confirmed = window.confirm(
      'Stop all pending approvals, pause AI Assist, and disable screen preview plus remote control?'
    );
    if (!confirmed) {
      return;
    }

    assistantEngineRef.current?.pause();
    approvalController.cancelAllPending('Stop all requested');
    updateSettings({
      allowControlEnabled: false,
      screenPreviewEnabled: false,
    });
    setInputPermissionError(null);
    void exitOverlayMode()
      .then((next) => {
        setOverlayModeStatus(next);
      })
      .catch((err) => {
        console.error('[App] Failed to exit overlay mode after Stop All:', err);
      });
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
  const isOverlayActive = Boolean(overlayModeStatus?.active && aiState?.isRunning);
  const subscriptionStatus = desktopBootstrap?.billing.subscriptionStatus ?? 'inactive';
  const localPlanPolicy = getLocalAiPlanPolicy(desktopBootstrap?.billing ?? desktopAccount?.billing);
  const localTaskAllowance = canStartManagedLocalTask(localPlanPolicy, localAiTaskUsage);
  const siblingDevices = desktopAccount?.devices.filter((device) => device.deviceId !== desktopAccount.currentDevice?.deviceId) ?? [];
  const assistantReadiness = evaluateDesktopTaskReadiness({
    mode: 'ai_assist',
    subscriptionStatus,
    platform,
    permissionStatus,
    localSettings,
    workspaceConfigured: workspaceState.configured,
    providerConfigured,
    isManagedLocalProvider: llmSettings.provider === DEFAULT_LLM_PROVIDER,
    requireControl: false,
  });
  const taskReadiness = evaluateDesktopTaskReadiness({
    mode: 'ai_assist',
    subscriptionStatus,
    platform,
    permissionStatus,
    localSettings,
    workspaceConfigured: workspaceState.configured,
    providerConfigured,
    isManagedLocalProvider: llmSettings.provider === DEFAULT_LLM_PROVIDER,
    requireControl: false,
  });
  const controlReadiness = evaluateDesktopTaskReadiness({
    mode: 'ai_assist',
    subscriptionStatus,
    platform,
    permissionStatus,
    localSettings,
    workspaceConfigured: workspaceState.configured,
    providerConfigured,
    isManagedLocalProvider: llmSettings.provider === DEFAULT_LLM_PROVIDER,
    requireControl: true,
  });
  const controlSetupItems = controlReadiness.requiredSetup.filter(
    (item) => !taskReadiness.requiredSetup.some((existing) => existing.id === item.id)
  );
  const overlayReadinessBlockers =
    controlSetupItems.length > 0 ? controlReadiness.blockers : assistantReadiness.blockers;
  const showFreeAiSetup =
    isSignedIn
    && llmSettings.provider === DEFAULT_LLM_PROVIDER
    && !providerConfigured;
  const showVisionBoostSetup =
    isSignedIn
    && llmSettings.provider === DEFAULT_LLM_PROVIDER
    && (visionBoostRequested || Boolean(localAiRecommendation?.visionAvailable || localAiStatus?.selectedTier === 'vision'));
  const assistantSetupMessage = showFreeAiSetup
    ? localAiInstallProgress?.message
        || localAiRecommendation?.reason
        || 'Set up Free AI to prepare the local assistant for this desktop.'
    : assistantReadiness.requiredSetup[0]?.detail || 'Open settings or permission prompts to finish setup.';
  const accessibilityPermissionBannerMessage = getPermissionBannerMessage('accessibility', platform);
  const accessibilityPermissionSettingsLabel = getPermissionSettingsButtonLabel('accessibility', platform);
  const overlayStatusLabel = aiState?.status === 'paused'
    ? 'GORKH is paused.'
    : aiState?.status === 'awaiting_approval'
      ? 'Waiting for your approval.'
      : aiState?.status === 'asking_user'
        ? 'Waiting for your response.'
        : aiState?.status === 'executing'
          ? 'GORKH is working…'
          : aiState?.status === 'done'
            ? 'GORKH is done.'
            : aiState?.status === 'error'
              ? 'GORKH hit an error.'
              : 'GORKH is thinking…';
  const userMessages = messages.filter((item) => item.role === 'user');
  const latestUserMessageText = userMessages[userMessages.length - 1]?.text ?? null;
  const activeRunDisplayGoal = activeRun
    ? getAssistantDisplayGoal(activeRun.goal, latestUserMessageText)
    : null;
  const overlayGoal = activeRun
    ? getAssistantDisplayGoal(activeRun.goal, latestUserMessageText)
    : latestUserMessageText;
  const overlayPreviewMessages = messages.slice(-4);
  const overlayWorkspaceLabel = workspaceState.configured ? workspaceState.rootName || 'Configured' : 'Not configured';

  useEffect(() => {
    if (!client || !assistantReadiness.ready) {
      return;
    }

    if (!activeRun || activeRun.mode !== 'ai_assist' || !isAssistantRunActive(activeRun)) {
      return;
    }

    if (assistantStartingRunIdRef.current === activeRun.runId) {
      return;
    }

    void startAssistantEngine(activeRun.runId, activeRun.goal);
  }, [
    activeRun,
    assistantReadiness.ready,
    client,
    startAssistantEngine,
  ]);

  useEffect(() => {
    if (!runtimeConfig || !sessionDeviceToken || authState !== 'signed_in' || status !== 'connected') {
      return;
    }

    if (llmSettings.provider !== DEFAULT_LLM_PROVIDER) {
      return;
    }

    if (!assistantReadiness.ready) {
      return;
    }

    if (desktopBootstrapBusy || (!desktopBootstrap && !desktopBootstrapError)) {
      return;
    }

    if (assistantAutoStartAttemptedRef.current || assistantAutoStartInFlightRef.current) {
      return;
    }

    if (activeRun && isAssistantRunActive(activeRun)) {
      if (activeRun.mode === 'ai_assist') {
        assistantAutoStartAttemptedRef.current = true;
      }
      return;
    }

    assistantAutoStartInFlightRef.current = true;
    const freeAiReady = localAiStatus?.runtimeRunning === true && localAiStatus?.installStage === 'ready';
    void createDesktopRun(runtimeConfig, sessionDeviceToken, {
      goal: buildAssistantOpeningGoal(freeAiReady),
      mode: 'ai_assist',
    })
      .then((run) => {
        assistantAutoStartAttemptedRef.current = true;
        setActiveRun(run);
        setRecentRuns((currentRuns) => upsertRunHistory(currentRuns, run));
      })
      .catch((err) => {
        console.error('[App] Failed to auto-start assistant session:', err);
      })
      .finally(() => {
        assistantAutoStartInFlightRef.current = false;
      });
  }, [
    activeRun,
    assistantReadiness.ready,
    authState,
    desktopBootstrap,
    desktopBootstrapBusy,
    desktopBootstrapError,
    llmSettings.provider,
    localAiStatus,
    runtimeConfig,
    sessionDeviceToken,
    status,
  ]);

  const handleToggleAiPause = useCallback(() => {
    const engine = assistantEngineRef.current;
    if (!engine) {
      return;
    }

    if (engine.isPaused()) {
      engine.resume();
    } else {
      engine.pause();
    }

    setAiState(engine.getState());
  }, []);

  useEffect(() => {
    if (platform !== 'macos' || isOverlayActive) {
      return;
    }

    const windowHandle = getCurrentWindow();
    void windowHandle.setEffects({
      effects: [Effect.UnderWindowBackground, Effect.Sidebar],
      state: EffectState.Active,
      radius: 28,
    }).catch((error) => {
      console.error('[App] Failed to apply macOS window effects:', error);
    });

    return () => {
      void windowHandle.clearEffects().catch(() => {
        // Ignore cleanup failures when the window is closing or overlay mode changes.
      });
    };
  }, [isOverlayActive, platform]);

  useEffect(() => {
    if (!isOverlayActive && overlayDetailsOpen) {
      setOverlayDetailsOpen(false);
    }
  }, [isOverlayActive, overlayDetailsOpen]);

  const shellBlur = platform === 'macos' ? 'blur(28px) saturate(165%)' : 'blur(18px) saturate(135%)';
  const homeTopInset = platform === 'macos' ? '4.25rem' : '1.5rem';
  const frameStyle: CSSProperties = {
    maxWidth: '1180px',
    margin: '0 auto',
    padding: '1.35rem',
    borderRadius: '32px',
    background: isOverlayActive
      ? 'rgba(2, 3, 5, 0.92)'
      : platform === 'macos'
        ? 'linear-gradient(180deg, rgba(255,255,255,0.58) 0%, rgba(241,245,249,0.52) 100%)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)',
    border: '1px solid rgba(255,255,255,0.38)',
    boxShadow: '0 34px 90px rgba(15, 23, 42, 0.18)',
    backdropFilter: shellBlur,
    WebkitBackdropFilter: shellBlur,
  };
  const panelStyle: CSSProperties = {
    padding: '1rem',
    background: platform === 'macos' ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.96)',
    borderRadius: '22px',
    border: '1px solid rgba(148,163,184,0.24)',
    boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
  };
  const subPanelStyle: CSSProperties = {
    padding: '0.9rem',
    background: platform === 'macos' ? 'rgba(255,255,255,0.78)' : '#f9fafb',
    borderRadius: '18px',
    border: '1px solid rgba(148,163,184,0.18)',
  };
  const settingsOperationalPanels = isSignedIn ? (
    <>
      <section style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111827' }}>Desktop overview</h3>
            <p style={{ margin: '0.35rem 0 0', color: '#475569', fontSize: '0.875rem', maxWidth: '64ch' }}>
              Readiness, signed-in desktops, and recent activity live here so the home screen can stay focused on chat and approvals.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.875rem', color: '#475569' }}>
              Desktop ID: <code>{deviceId}</code>
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#475569' }}>
              <span>Assistant engine</span>
              <select
                value={assistantEngineId}
                onChange={(event) => setAssistantEngineId(event.target.value as AssistantEngineId)}
                style={{ padding: '0.45rem 0.6rem', borderRadius: '10px', border: '1px solid rgba(148,163,184,0.28)', background: 'rgba(255,255,255,0.85)' }}
              >
                {assistantEngineCatalog.map((engine) => (
                  <option key={engine.id} value={engine.id}>
                    {engine.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div
          style={{
            marginTop: '1rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1rem',
          }}
        >
          <section style={subPanelStyle}>
            <h4 style={{ margin: 0, fontSize: '0.98rem' }}>Desktop readiness</h4>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
              Subscription, permissions, workspace, and Free AI setup for this desktop.
            </p>

            {desktopBootstrapBusy && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#64748b' }}>
                Loading desktop readiness...
              </p>
            )}

            {desktopBootstrapError && (
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '12px',
                  fontSize: '0.875rem',
                  color: '#991b1b',
                }}
              >
                <div>{desktopBootstrapError}</div>
                <button
                  onClick={handleRefreshDesktopOverview}
                  disabled={desktopBootstrapBusy}
                  style={{
                    marginTop: '0.65rem',
                    padding: '0.45rem 0.7rem',
                    borderRadius: '10px',
                    border: '1px solid #fca5a5',
                    background: '#ffffff',
                    color: '#991b1b',
                    cursor: desktopBootstrapBusy ? 'not-allowed' : 'pointer',
                    opacity: desktopBootstrapBusy ? 0.7 : 1,
                  }}
                >
                  Retry now
                </button>
              </div>
            )}

            <div style={{ marginTop: '1rem', display: 'grid', gap: '0.45rem' }}>
              <div style={{ fontSize: '0.875rem' }}>
                <strong>Plan:</strong> {localPlanPolicy.plan === 'plus' ? 'Plus' : 'Free local'}
              </div>
              <div style={{ fontSize: '0.875rem' }}>
                <strong>Billing subscription:</strong> {subscriptionStatus === 'active' ? 'Active' : 'Inactive'}
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
                <strong>Assistant engine:</strong> {providerCheckBusy
                  ? 'Checking...'
                  : llmSettings.provider === DEFAULT_LLM_PROVIDER
                    ? providerConfigured
                      ? 'Free AI ready'
                      : 'Free AI not ready'
                    : providerConfigured
                      ? 'Custom model ready'
                      : 'Custom model not ready'}
              </div>
            </div>

            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: taskReadiness.ready ? '#ecfdf5' : '#fff7ed',
                border: `1px solid ${taskReadiness.ready ? '#86efac' : '#fdba74'}`,
                borderRadius: '12px',
                fontSize: '0.875rem',
                color: taskReadiness.ready ? '#166534' : '#9a3412',
              }}
            >
              {taskReadiness.ready
                ? 'This desktop is ready to launch work directly.'
                : `Launching work is blocked by ${taskReadiness.requiredSetup.length} readiness item${taskReadiness.requiredSetup.length === 1 ? '' : 's'}.`}
            </div>

            {taskReadiness.requiredSetup.length > 0 && (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                {taskReadiness.requiredSetup.map((blocker) => (
                  <div
                    key={blocker.id}
                    style={{
                      padding: '0.75rem',
                      background: 'rgba(255,255,255,0.72)',
                      borderRadius: '12px',
                      border: '1px solid rgba(148,163,184,0.2)',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{blocker.label}</div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#64748b' }}>{blocker.detail}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {blocker.id === 'screen-preview' && (
                        <button
                          onClick={() => handleScreenPreviewToggle(true)}
                          style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                        >
                          Enable Screen Preview
                        </button>
                      )}
                      {blocker.id === 'control-toggle' && (
                        <button
                          onClick={() => handleControlToggle(true)}
                          style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                        >
                          Enable Allow Control
                        </button>
                      )}
                      {(blocker.id === 'screen-permission' || blocker.id === 'accessibility-permission') && (
                        <button
                          onClick={() => void handleOpenPermissionSettings(blocker.id === 'screen-permission' ? 'screenRecording' : 'accessibility')}
                          style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                        >
                          Open Permission Settings
                        </button>
                      )}
                      {(blocker.id === 'workspace' || blocker.id === 'provider') && (
                        <button
                          onClick={() => setSettingsOpen(true)}
                          style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                        >
                          Open Settings
                        </button>
                      )}
                      {blocker.id === 'local-engine' && (
                        <button
                          onClick={() => {
                            if (showFreeAiSetup) {
                              void handleStartFreeAi(localAiRecommendation?.tier ?? 'light');
                              return;
                            }
                            setSettingsOpen(true);
                          }}
                          style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                        >
                          {showFreeAiSetup ? 'Set Up Free AI' : 'Open Settings'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {controlSetupItems.length > 0 && (
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.85rem',
                  background: '#eff6ff',
                  border: '1px solid #93c5fd',
                  borderRadius: '12px',
                  color: '#1d4ed8',
                }}
              >
                <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  Desktop control needs {controlSetupItems.length} more item{controlSetupItems.length === 1 ? '' : 's'}.
                </div>
                <div style={{ marginTop: '0.35rem', fontSize: '0.8125rem', color: '#475569' }}>
                  Chat and planning can start now. GORKH will only click, type, and control other apps after this desktop is ready.
                </div>
                <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                  {controlSetupItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '0.75rem',
                        background: 'rgba(255,255,255,0.72)',
                        borderRadius: '12px',
                        border: '1px solid rgba(148,163,184,0.2)',
                      }}
                    >
                      <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{item.label}</div>
                      <div style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#64748b' }}>{item.detail}</div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        {item.id === 'control-toggle' && (
                          <button
                            onClick={() => handleControlToggle(true)}
                            style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                          >
                            Enable Allow Control
                          </button>
                        )}
                        {item.id === 'accessibility-permission' && (
                          <button
                            onClick={() => void handleOpenPermissionSettings('accessibility')}
                            style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                          >
                            Open Permission Settings
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section style={subPanelStyle}>
            <h4 style={{ margin: 0, fontSize: '0.98rem' }}>Signed-in desktops</h4>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
              See this signed-in desktop and any others connected to your account.
            </p>

            {desktopAccountBusy && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#64748b' }}>
                Loading signed-in desktops...
              </p>
            )}

            {desktopAccountError && (
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '12px',
                  fontSize: '0.875rem',
                  color: '#991b1b',
                }}
              >
                <div>{desktopAccountError}</div>
                <button
                  onClick={handleRefreshDesktopOverview}
                  disabled={desktopAccountBusy}
                  style={{
                    marginTop: '0.65rem',
                    padding: '0.45rem 0.7rem',
                    borderRadius: '10px',
                    border: '1px solid #fca5a5',
                    background: '#ffffff',
                    color: '#991b1b',
                    cursor: desktopAccountBusy ? 'not-allowed' : 'pointer',
                    opacity: desktopAccountBusy ? 0.7 : 1,
                  }}
                >
                  Retry now
                </button>
              </div>
            )}

            {desktopAccount && (
              <div
                style={{
                  marginTop: '1rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '0.85rem',
                }}
              >
                <div style={subPanelStyle}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>This desktop</div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                    {desktopAccount.currentDevice?.deviceName || `Desktop-${deviceId.slice(0, 8)}`}
                  </div>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#64748b' }}>
                    {desktopAccount.user.email} • {desktopAccount.billing.subscriptionStatus === 'active' ? 'Subscription active' : 'Subscription inactive'}
                  </div>
                  {desktopAccount.currentDevice && (
                    <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#64748b' }}>
                      {desktopAccount.currentDevice.platform} • {desktopAccount.currentDevice.connected ? 'Connected' : 'Offline'}
                    </div>
                  )}
                </div>

                <div style={subPanelStyle}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Other signed-in desktops</div>
                  {siblingDevices.length === 0 ? (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
                      No other signed-in desktops on this account.
                    </p>
                  ) : (
                    <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.5rem' }}>
                      {siblingDevices.map((device) => (
                        <div
                          key={device.deviceId}
                          style={{
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.8)',
                            borderRadius: '12px',
                            border: '1px solid rgba(148,163,184,0.18)',
                          }}
                        >
                          <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                            {device.deviceName || `Desktop-${device.deviceId.slice(0, 8)}`}
                          </div>
                          <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#64748b' }}>
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
                              borderRadius: '10px',
                              border: '1px solid #fdba74',
                              background: deviceRevokeBusyId === device.deviceId ? '#e5e7eb' : '#fff7ed',
                              color: deviceRevokeBusyId === device.deviceId ? '#6b7280' : '#9a3412',
                              cursor: deviceRevokeBusyId === device.deviceId ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {deviceRevokeBusyId === device.deviceId ? 'Signing out...' : 'Sign out this desktop'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section style={subPanelStyle}>
            <h4 style={{ margin: 0, fontSize: '0.98rem' }}>Recent activity</h4>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
              Previous assistant work on this desktop stays here for quick reference.
            </p>

            {recentRuns.length === 0 ? (
              <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b' }}>
                No recent assistant activity yet.
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
                      background: activeRun?.runId === run.runId ? '#eff6ff' : 'rgba(255,255,255,0.78)',
                      border: activeRun?.runId === run.runId ? '1px solid #93c5fd' : '1px solid rgba(148,163,184,0.18)',
                      borderRadius: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                      {getAssistantDisplayGoal(run.goal)}
                    </div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#64748b' }}>
                      {run.status} • {new Date(run.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      {client && (
        <section style={{ ...panelStyle, marginTop: '1rem' }}>
          <div style={{ marginBottom: '0.9rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#111827' }}>Live desktop controls</h3>
            <p style={{ margin: '0.35rem 0 0', color: '#475569', fontSize: '0.875rem' }}>
              Screen preview and remote control stay available here when you need them, without crowding the main chat surface.
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '1rem',
            }}
          >
            <ScreenPanel
              wsClient={client}
              deviceId={deviceId}
              enabled={localSettings.screenPreviewEnabled}
              onToggle={handleScreenPreviewToggle}
              onDisplayChange={setPrimaryDisplayId}
              permissionStatus={permissionStatus}
              onOpenPermissionSettings={handleOpenPermissionSettings}
              onPermissionIssue={(message) => notePermissionIssue('screenRecording', message)}
              embedded
            />
            <ControlPanel
              wsClient={client}
              deviceId={deviceId}
              enabled={localSettings.allowControlEnabled}
              onToggle={handleControlToggle}
              embedded
            />
          </div>
        </section>
      )}
    </>
  ) : null;

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: isOverlayActive ? 'transparent' : platform === 'macos' ? 'transparent' : '#eef2f7',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {!isOverlayActive && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: platform === 'macos'
                ? 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(226,232,240,0.06) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(241,245,249,0.92) 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '-18%',
              right: '-10%',
              width: '34rem',
              height: '34rem',
              borderRadius: '9999px',
              background: 'radial-gradient(circle, rgba(148,163,184,0.26) 0%, rgba(148,163,184,0) 70%)',
              filter: 'blur(18px)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-24%',
              left: '-8%',
              width: '30rem',
              height: '30rem',
              borderRadius: '9999px',
              background: 'radial-gradient(circle, rgba(226,232,240,0.32) 0%, rgba(226,232,240,0) 72%)',
              filter: 'blur(20px)',
            }}
          />
        </>
      )}

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          padding: `${homeTopInset} 1.5rem 2rem`,
          overflow: 'auto',
          opacity: isOverlayActive ? 0 : 1,
          pointerEvents: isOverlayActive ? 'none' : 'auto',
          filter: isOverlayActive ? 'blur(18px)' : 'none',
          transform: isOverlayActive ? 'scale(1.015)' : 'scale(1)',
          transition: 'opacity 220ms ease, filter 220ms ease, transform 220ms ease',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={frameStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div data-tauri-drag-region style={{ paddingLeft: platform === 'macos' ? '5.5rem' : 0, minHeight: platform === 'macos' ? '2.25rem' : undefined }}>
              <BrandWordmark width={220} subtitle="Desktop intelligence layer" />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                onClick={handleStopAll}
                disabled={approvalItems.every((item) => item.state !== 'pending') && !aiState?.isRunning}
                style={{
                  padding: '0.6rem 1rem',
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '9999px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  opacity: approvalItems.every((item) => item.state !== 'pending') && !aiState?.isRunning ? 0.5 : 1,
                  boxShadow: '0 14px 32px rgba(239,68,68,0.24)',
                }}
              >
                Stop All
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                style={{
                  padding: '0.6rem 1rem',
                  background: 'rgba(255,255,255,0.8)',
                  border: '1px solid rgba(148,163,184,0.24)',
                  borderRadius: '9999px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#0f172a',
                }}
              >
                Settings
              </button>
            </div>
          </div>
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
        <div
          style={{
            ...panelStyle,
            marginTop: '1.5rem',
            maxWidth: isSignedIn ? 'unset' : '460px',
            display: isSignedIn ? 'flex' : 'block',
            justifyContent: isSignedIn ? 'space-between' : undefined,
            alignItems: isSignedIn ? 'center' : undefined,
            gap: isSignedIn ? '1rem' : undefined,
          }}
        >
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
                This desktop is signed in and will reconnect automatically the next time you open it.
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
            <section
              style={{
                marginTop: '1.5rem',
                ...panelStyle,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Assistant</h2>
                  <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem', maxWidth: '52ch' }}>
                    Ask naturally and the desktop will create or resume work under the hood without making you manage runs manually.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: assistantReadiness.ready ? '#dcfce7' : '#fff7ed',
                      color: assistantReadiness.ready ? '#166534' : '#9a3412',
                    }}
                  >
                    {assistantReadiness.ready ? 'Ready to use' : 'Setup needed'}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: '#eff6ff',
                      color: '#1d4ed8',
                    }}
                  >
                    Assistant engine: {llmSettings.provider === DEFAULT_LLM_PROVIDER ? 'Free AI' : getLlmProviderLabel(llmSettings.provider)}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: localPlanPolicy.plan === 'plus' ? '#ede9fe' : '#fef3c7',
                      color: localPlanPolicy.plan === 'plus' ? '#6d28d9' : '#92400e',
                    }}
                  >
                    {localPlanPolicy.plan === 'plus' ? 'Plus plan' : 'Free plan'}
                  </span>
                  {activeRun && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: '#f3f4f6',
                        color: '#334155',
                      }}
                    >
                      Current task: {activeRun.status}
                    </span>
                  )}
                </div>
              </div>

              {!assistantReadiness.ready && (
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.9rem 1rem',
                    background: '#fff7ed',
                    border: '1px solid #fdba74',
                    borderRadius: '10px',
                    color: '#9a3412',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>The assistant needs setup before it can act.</div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.875rem' }}>
                    {assistantSetupMessage}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    {showFreeAiSetup && (
                      <button
                        onClick={() => {
                          void handleStartFreeAi(localAiRecommendation?.tier ?? 'light');
                        }}
                        disabled={localAiActionBusy}
                        style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: localAiActionBusy ? 'not-allowed' : 'pointer' }}
                      >
                        {localAiActionBusy ? 'Preparing Free AI...' : 'Set Up Free AI'}
                      </button>
                    )}
                    <button
                      onClick={() => setSettingsOpen(true)}
                      style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                    >
                      Open Settings
                    </button>
                    {(assistantReadiness.requiredSetup.some((item) => item.id === 'screen-permission') ||
                      assistantReadiness.requiredSetup.some((item) => item.id === 'accessibility-permission')) && (
                      <button
                        onClick={() =>
                          void handleOpenPermissionSettings(
                            assistantReadiness.requiredSetup.some((item) => item.id === 'screen-permission')
                              ? 'screenRecording'
                              : 'accessibility'
                          )
                        }
                        style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
                      >
                        Open Permission Settings
                      </button>
                    )}
                  </div>
                </div>
              )}

              {assistantReadiness.ready && controlSetupItems.length > 0 && (
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.9rem 1rem',
                    background: '#eff6ff',
                    border: '1px solid #93c5fd',
                    borderRadius: '10px',
                    color: '#1d4ed8',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>AI chat is ready. Desktop control still needs setup.</div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.875rem' }}>
                    GORKH can chat and plan now, but clicks, typing, and app control stay paused until these items are ready.
                  </div>
                  <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                    {controlSetupItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.82)',
                          borderRadius: '10px',
                          border: '1px solid rgba(59,130,246,0.25)',
                        }}
                      >
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e3a8a' }}>{item.label}</div>
                        <div style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#475569' }}>{item.detail}</div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          {item.id === 'control-toggle' && (
                            <button
                              onClick={() => handleControlToggle(true)}
                              style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #bfdbfe', background: 'white', cursor: 'pointer' }}
                            >
                              Enable Allow Control
                            </button>
                          )}
                          {item.id === 'accessibility-permission' && (
                            <button
                              onClick={() => void handleOpenPermissionSettings('accessibility')}
                              style={{ padding: '0.45rem 0.65rem', borderRadius: '10px', border: '1px solid #bfdbfe', background: 'white', cursor: 'pointer' }}
                            >
                              Open Permission Settings
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(showFreeAiSetup || showVisionBoostSetup) && (
                <FreeAiSetupCard
                  status={localAiStatus}
                  installProgress={localAiInstallProgress}
                  recommendation={localAiRecommendation}
                  hardwareProfile={localAiHardwareProfile}
                  busy={localAiBusy}
                  actionBusy={localAiActionBusy}
                  error={localAiError}
                  showVisionBoost={showVisionBoostSetup}
                  onStart={(tier) => {
                    void handleStartFreeAi(tier);
                  }}
                  onEnableVisionBoost={() => {
                    void handleEnableVisionBoost();
                  }}
                  onRefresh={() => {
                    void refreshLocalAiState();
                  }}
                />
              )}

              <div style={{ marginTop: '1rem' }}>
                <div
                  style={{
                    marginBottom: '0.75rem',
                    padding: '0.75rem',
                    background: localPlanPolicy.plan === 'plus' ? '#f5f3ff' : '#fffbeb',
                    border: `1px solid ${localPlanPolicy.plan === 'plus' ? '#c4b5fd' : '#fde68a'}`,
                    borderRadius: '8px',
                    color: localPlanPolicy.plan === 'plus' ? '#5b21b6' : '#92400e',
                    fontSize: '0.875rem',
                  }}
                >
                  {localPlanPolicy.plan === 'plus'
                    ? 'Plus plan: unlimited local tasks and Vision Boost are enabled on this desktop.'
                    : `Free plan: ${localAiTaskUsage.tasksStarted}/${localPlanPolicy.localTaskLimit ?? 0} local tasks used today. Vision Boost is reserved for Plus.`}
                  {localTaskAllowance.remaining != null && (
                    <div style={{ marginTop: '0.35rem' }}>
                      {localTaskAllowance.remaining} free local task{localTaskAllowance.remaining === 1 ? '' : 's'} remaining today.
                    </div>
                  )}
                </div>
                <ChatOverlay
                  messages={messages}
                  status={status}
                  onSendMessage={handleSendMessage}
                  pendingTaskConfirmation={pendingTaskConfirmation}
                  pendingTaskConfirmationBusy={pendingTaskConfirmationBusy}
                  onConfirmPendingTask={handleConfirmPendingTask}
                  onCancelPendingTask={handleCancelPendingTask}
                />
              </div>
            </section>

            <section
              style={{
                ...panelStyle,
                marginTop: '1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>The home screen now stays focused on the assistant.</div>
                <div style={{ marginTop: '0.35rem', fontSize: '0.875rem', color: '#475569', maxWidth: '58ch' }}>
                  Screen preview, remote control, connected desktops, diagnostics, and update checks live inside Settings.
                </div>
              </div>
              <button
                onClick={() => setSettingsOpen(true)}
                style={{
                  padding: '0.65rem 1rem',
                  borderRadius: '9999px',
                  border: '1px solid rgba(148,163,184,0.24)',
                  background: 'rgba(255,255,255,0.84)',
                  color: '#0f172a',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Open Settings
              </button>
            </section>
          </>
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
              ? accessibilityPermissionBannerMessage
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
                {accessibilityPermissionSettingsLabel}
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
              displayGoal={activeRunDisplayGoal ?? undefined}
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

        {isSignedIn && (
          <section
            style={{
              marginTop: '1rem',
              ...panelStyle,
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1rem' }}>Pending approvals</h2>
            <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
              The assistant pauses here before privileged local actions or tools run.
            </p>

            {pendingApprovals.length === 0 ? (
              <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                No approvals are waiting right now.
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
        )}

        <p style={{ marginTop: '2rem', color: '#666', maxWidth: '600px' }}>
          {isSignedIn
            ? 'This desktop is connected directly to your account. The assistant runs here, and local approvals stay on this machine.'
            : 'Sign in from this desktop to connect it to your account and unlock the local assistant, approvals, and desktop controls.'}
        </p>
        
        {isSignedIn && isAiAssist && (
          <p style={{ color: '#8b5cf6', maxWidth: '600px' }}>
            🤖 <strong>Assistant safety:</strong> The desktop observes what is on screen, proposes one step at a time, and waits for your explicit approval before privileged actions.
          </p>
        )}
        </div>
      </div>

      {isOverlayActive && (
        <>
          <ActiveOverlayShell
            statusLabel={overlayStatusLabel}
            goal={overlayGoal}
            overlaySupported={overlayModeStatus?.supported !== false}
          />
          {overlayDetailsOpen && (
            <OverlayDetailsPanel
              goal={overlayGoal}
              statusLabel={overlayStatusLabel}
              runStatus={activeRun?.status ?? null}
              providerLabel={getLlmProviderLabel(llmSettings.provider)}
              workspaceLabel={overlayWorkspaceLabel}
              readinessBlockers={overlayReadinessBlockers}
              pendingApprovals={pendingApprovals}
              onClose={() => setOverlayDetailsOpen(false)}
              onOpenSettings={() => {
                setOverlayDetailsOpen(false);
                setSettingsOpen(true);
              }}
            />
          )}
          <OverlayController
            messages={overlayPreviewMessages}
            statusLabel={overlayStatusLabel}
            goal={overlayGoal}
            providerLabel={getLlmProviderLabel(llmSettings.provider)}
            isPaused={aiState?.status === 'paused'}
            detailsOpen={overlayDetailsOpen}
            onStop={handleStopAi}
            onPauseToggle={handleToggleAiPause}
            onOpenDetails={() => setOverlayDetailsOpen((current) => !current)}
          />
        </>
      )}

      {/* Approval Modal */}
      {pendingApproval && (
        <ApprovalModal
          approval={pendingApproval.approval}
          onDecision={handleApprovalDecision}
          overlayMode={isOverlayActive}
          onStopAll={handleStopAll}
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
          overlayMode={isOverlayActive}
          onStopAll={handleStopAll}
        />
      )}

      {pendingToolProposal && pendingToolApproval && workspaceState.configured && (
        <ToolApprovalModal
          approval={pendingToolApproval}
          toolCall={pendingToolProposal.toolCall}
          rationale={pendingToolProposal.rationale}
          onApprove={handleAiApproveTool}
          onDeny={handleAiRejectTool}
          overlayMode={isOverlayActive}
          onStopAll={handleStopAll}
        />
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          llmSettings={llmSettings}
          onLlmSettingsChange={setLlmSettings}
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
          overviewPanels={settingsOperationalPanels}
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
