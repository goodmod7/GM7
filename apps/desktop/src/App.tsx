import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ServerMessage, ServerPairingCode, ServerChatMessage, RunWithSteps, ApprovalRequest, InputAction, AgentProposal } from '@ai-operator/shared';
import { WsClient, type ConnectionStatus } from './lib/wsClient.js';
import { executeAction } from './lib/actionExecutor.js';
import { AiAssistController, type LlmSettings, type LocalToolEvent } from './lib/aiAssist.js';
import { getWorkspaceState, type LocalWorkspaceState } from './lib/workspace.js';
import { getSettings, setSetting, subscribe, type LocalSettingsState } from './lib/localSettings.js';
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

// Get WebSocket URL from env or default
const WS_URL = import.meta.env.VITE_API_WS_URL || 'ws://localhost:3001/ws';

interface ChatItem {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

function App() {
  const [client, setClient] = useState<WsClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
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
  const [pendingAction, setPendingAction] = useState<{ actionId: string; action: InputAction } | null>(null);
  const [inputPermissionError, setInputPermissionError] = useState<string | null>(null);

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

  useEffect(() => {
    aiControllerRef.current = aiController;
  }, [aiController]);

  useEffect(() => {
    controlEnabledRef.current = localSettings.allowControlEnabled;
  }, [localSettings.allowControlEnabled]);

  useEffect(() => {
    setLocalSettingsState(getSettings());
    const unsubscribe = subscribe((nextSettings) => {
      setLocalSettingsState(nextSettings);
    });
    return unsubscribe;
  }, []);

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
        appVersion: '0.0.5',
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
          // Only show if control is enabled
          if (controlEnabledRef.current) {
            setPendingAction({ actionId, action });
            // Send ack that we're showing the modal
            wsClient?.sendActionAck(actionId, 'awaiting_user');
          }
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
      wsClient.connect(WS_URL);

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
    if (!pendingAction || !client) return;
    
    const { actionId, action } = pendingAction;
    
    // Send approved ack
    client.sendActionAck(actionId, 'approved');
    
    // Execute the action
    const result = await executeAction(action);
    
    if (!result.ok) {
      setInputPermissionError(result.error?.message || 'Input injection failed');
    }
    
    // Send result
    client.sendActionResult(actionId, result.ok, result.error);
    
    setPendingAction(null);
  }, [pendingAction, client]);

  const handleActionDeny = useCallback(() => {
    if (!pendingAction || !client) return;
    
    const { actionId } = pendingAction;
    
    client.sendActionAck(actionId, 'denied');
    client.sendActionResult(actionId, false, { code: 'DENIED_BY_USER', message: 'User denied the action' });
    
    setPendingAction(null);
  }, [pendingAction, client]);

  const handleControlToggle = useCallback((enabled: boolean) => {
    setSetting('allowControlEnabled', enabled);
    if (!enabled) {
      setInputPermissionError(null);
    }
  }, []);

  const handleScreenPreviewToggle = useCallback((enabled: boolean) => {
    setSetting('screenPreviewEnabled', enabled);
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
  const handleAiApproveAction = useCallback(() => {
    aiController?.approveAction();
  }, [aiController]);

  const handleAiRejectAction = useCallback(() => {
    aiController?.rejectAction();
  }, [aiController]);

  const handleAiApproveTool = useCallback(() => {
    if (!workspaceState.configured) {
      return;
    }
    aiController?.approveTool();
  }, [aiController, workspaceState.configured]);

  const handleAiRejectTool = useCallback(() => {
    aiController?.rejectTool();
  }, [aiController]);

  const handleAiUserResponse = useCallback((response: string) => {
    aiController?.userResponse(response);
  }, [aiController]);

  const handleStopAi = useCallback(() => {
    aiController?.stop('User stopped');
    if (activeRun) {
      client?.sendRunUpdate(activeRun.runId, 'canceled', 'AI Assist stopped by user');
      setActiveRun((prev) => (prev ? { ...prev, status: 'canceled' } : prev));
    }
    setAiController(null);
    setAiState(null);
    setCurrentProposal(undefined);
  }, [aiController, activeRun, client]);

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

  const isAiAssist = activeRun?.mode === 'ai_assist';
  const activeToolHistory = activeRun ? toolHistoryByRun[activeRun.runId] || [] : [];
  const pendingToolProposal =
    currentProposal?.kind === 'propose_tool' && aiState?.status === 'awaiting_approval'
      ? currentProposal
      : null;

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f5f5f5', display: 'flex' }}>
      {/* Main Content */}
      <div style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>AI Operator Desktop</h1>
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
        <p>Device ID: <code>{deviceId}</code></p>
        
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
          
          {status === 'disconnected' && (
            <button onClick={() => client?.connect(WS_URL)}>
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
      {pendingAction && (
        <ActionApprovalModal
          actionId={pendingAction.actionId}
          action={pendingAction.action}
          onApprove={handleActionApprove}
          onDeny={handleActionDeny}
        />
      )}

      {pendingToolProposal && workspaceState.configured && (
        <ToolApprovalModal
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
