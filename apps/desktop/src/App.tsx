import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ServerMessage, ServerPairingCode, ServerChatMessage, RunWithSteps, ApprovalRequest, InputAction, AgentProposal } from '@ai-operator/shared';
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
import { AiAssistController, type LlmSettings, type LocalToolEvent } from './lib/aiAssist.js';
import { desktopRuntimeConfig } from './lib/desktopRuntimeConfig.js';
import {
  getPermissionStatus,
  openPermissionSettings,
  type NativePermissionStatus,
  type PermissionTarget,
} from './lib/permissions.js';
import { getWorkspaceState, type LocalWorkspaceState } from './lib/workspace.js';
import { getSettings, setSetting, subscribe, updateSettings, type LocalSettingsState } from './lib/localSettings.js';
import { ChatOverlay } from './components/ChatOverlay.js';
import { RunPanel } from './components/RunPanel.js';
import { ApprovalModal } from './components/ApprovalModal.js';
import { ScreenPanel } from './components/ScreenPanel.js';
import { ControlPanel } from './components/ControlPanel.js';
import { ActionApprovalModal } from './components/ActionApprovalModal.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ToolApprovalModal } from './components/ToolApprovalModal.js';

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
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');
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
  const [llmSettings, setLlmSettings] = useState<LlmSettings>({
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4.1-mini',
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    const saved = localStorage.getItem('ai-operator-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setLlmSettings((s) => ({ ...s, ...parsed }));
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
          wsClient?.setDeviceToken(nextDeviceToken);
          wsClient?.sendDeviceTokenAck();
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
            return;
          }

          wsClient?.sendActionAck(actionId, 'awaiting_user');
        },
        // Iteration 6: AI Assist callbacks
        onRunStart: (runId, goal, mode) => {
          console.log('[App] Run started:', runId, 'mode:', mode);
          if (mode === 'ai_assist') {
            // Start AI Assist controller
            startAiAssist(runId, goal);
          }
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

    // Check if API key is configured
    const { hasLlMProviderConfigured } = await import('./lib/aiAssist.js');
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
      case 'server.pairing.code': {
        const payload = (message as ServerPairingCode).payload;
        setPairingCode(payload.pairingCode);
        setPairingExpiresAt(payload.expiresAt);
        break;
      }

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

  // Handle requesting a pairing code
  const handleRequestPairingCode = useCallback(() => {
    client?.requestPairingCode();
  }, [client]);

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

  // Format time remaining for pairing code
  const getTimeRemaining = (): string => {
    if (!pairingExpiresAt) return '';
    const remaining = Math.max(0, pairingExpiresAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

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
          
          {status === 'disconnected' && runtimeConfig && (
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

        {/* Pairing Section */}
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'white', borderRadius: '8px', maxWidth: '400px' }}>
          <h3 style={{ marginTop: 0 }}>Device Pairing</h3>
          
          {!pairingCode ? (
            <button
              onClick={handleRequestPairingCode}
              disabled={status !== 'connected'}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: status === 'connected' ? '#0070f3' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: status === 'connected' ? 'pointer' : 'not-allowed',
              }}
            >
              Request Pairing Code
            </button>
          ) : (
            <div>
              <div
                style={{
                  padding: '1rem',
                  background: '#f0f0f0',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '1.5rem',
                  letterSpacing: '0.2em',
                  textAlign: 'center',
                  marginBottom: '0.5rem',
                }}
              >
                {pairingCode}
              </div>
              <p style={{ margin: 0, color: '#666', fontSize: '0.875rem' }}>
                Expires in: {getTimeRemaining()}
              </p>
              <button
                onClick={() => {
                  setPairingCode(null);
                  setPairingExpiresAt(null);
                }}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'transparent',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
            </div>
          )}
          
          {status !== 'connected' && (
            <p style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Connect to server to request pairing code
            </p>
          )}
        </div>

        {/* Screen Panel */}
        {client && (
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
        {client && (
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

        <p style={{ marginTop: '2rem', color: '#666', maxWidth: '600px' }}>
          This window shows the AI Operator desktop interface. When a run is started from the web dashboard,
          it will appear above with live steps, logs, and approval requests.
        </p>
        
        {isAiAssist && (
          <p style={{ color: '#8b5cf6', maxWidth: '600px' }}>
            🤖 <strong>AI Assist Mode:</strong> The AI will analyze your screen and propose actions one at a time.
            Every action requires your explicit approval before execution.
          </p>
        )}
      </div>

      {/* Chat Overlay */}
      <ChatOverlay
        messages={messages}
        status={status}
        onSendMessage={handleSendMessage}
      />

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
