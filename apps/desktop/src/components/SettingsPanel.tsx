import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import {
  clearWorkspace,
  configureWorkspace,
  getWorkspaceState,
  selectWorkspaceDirectory,
  type LocalWorkspaceState,
} from '../lib/workspace.js';
import type { LocalSettingsState } from '../lib/localSettings.js';
import {
  getPermissionInstructions,
  type NativePermissionStatus,
  type PermissionTarget,
} from '../lib/permissions.js';
import {
  getLlmDefaults,
  getLlmProviderDefinition,
  getLlmProviderLabel,
  getSupportedLlmProviders,
  isPaidLlmProvider,
  providerRequiresApiKey,
  type LlmProvider,
  type LlmSettings,
} from '../lib/llmConfig.js';
import { BrandWordmark } from './BrandWordmark.js';

export type WorkspaceState = LocalWorkspaceState;

const UPDATER_ENABLED = import.meta.env.VITE_DESKTOP_UPDATER_ENABLED === 'true';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  llmSettings: LlmSettings;
  onLlmSettingsChange: (settings: LlmSettings) => void;
  localSettings: LocalSettingsState;
  autostartSupported: boolean;
  autostartBusy?: boolean;
  autostartError?: string | null;
  onStartMinimizedChange: (enabled: boolean) => void;
  onAutostartChange: (enabled: boolean) => void;
  onScreenPreviewToggle: (enabled: boolean) => void;
  onAllowControlToggle: (enabled: boolean) => void;
  onWorkspaceChange?: (state: WorkspaceState) => void;
  apiHttpBase: string | null;
  runtimeConfigError?: string | null;
  permissionStatus: NativePermissionStatus;
  permissionStatusBusy?: boolean;
  onRefreshPermissionStatus: () => void | Promise<void>;
  onOpenPermissionSettings: (target: PermissionTarget) => void | Promise<void>;
  permissionHintTarget?: PermissionTarget | null;
  permissionHintMessage?: string | null;
  onExportDiagnostics: () => void | Promise<void>;
  diagnosticsStatus?: string | null;
}

export function SettingsPanel({
  isOpen,
  onClose,
  llmSettings,
  onLlmSettingsChange,
  localSettings,
  autostartSupported,
  autostartBusy = false,
  autostartError,
  onStartMinimizedChange,
  onAutostartChange,
  onScreenPreviewToggle,
  onAllowControlToggle,
  onWorkspaceChange,
  apiHttpBase,
  runtimeConfigError,
  permissionStatus,
  permissionStatusBusy = false,
  onRefreshPermissionStatus,
  onOpenPermissionSettings,
  permissionHintTarget,
  permissionHintMessage,
  onExportDiagnostics,
  diagnosticsStatus,
}: SettingsPanelProps) {
  const settings = llmSettings;
  const providerDefinition = getLlmProviderDefinition(settings.provider);
  const supportedProviders = getSupportedLlmProviders();
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [updateResult, setUpdateResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Workspace state
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ configured: false });
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const screenRecordingInstructions = getPermissionInstructions('screenRecording');
  const accessibilityInstructions = getPermissionInstructions('accessibility');

  useEffect(() => {
    // Load workspace state
    void loadWorkspaceState();
  }, []);

  useEffect(() => {
    void checkApiKey(settings.provider);
  }, [settings.provider]);
  
  // Load workspace state from Rust
  const loadWorkspaceState = async () => {
    try {
      const state = await getWorkspaceState();
      setWorkspaceState(state);
    } catch (e) {
      console.error('Failed to load workspace state:', e);
    }
  };
  
  // Handle choose workspace folder
  const handleChooseWorkspace = async () => {
    setIsLoadingWorkspace(true);
    try {
      const selected = await selectWorkspaceDirectory();
      
      if (selected && typeof selected === 'string') {
        const newState = await configureWorkspace(selected);
        setWorkspaceState(newState);
        onWorkspaceChange?.(newState);
      }
    } catch (e) {
      console.error('Failed to choose workspace:', e);
    } finally {
      setIsLoadingWorkspace(false);
    }
  };
  
  // Handle clear workspace
  const handleClearWorkspace = async () => {
    setIsLoadingWorkspace(true);
    try {
      const newState = await clearWorkspace();
      setWorkspaceState(newState);
      onWorkspaceChange?.(newState);
    } catch (e) {
      console.error('Failed to clear workspace:', e);
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  const checkApiKey = async (provider?: LlmProvider) => {
    const providerToCheck = provider || settings.provider;
    try {
      if (!providerRequiresApiKey(providerToCheck)) {
        setHasKey(false);
        return;
      }

      const has = await invoke<boolean>('has_llm_api_key', { provider: providerToCheck });
      setHasKey(has);
    } catch (e) {
      console.error('Failed to check API key:', e);
      setHasKey(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;

    setIsLoading(true);
    try {
      const result = await invoke<{ ok: boolean; error?: string }>('set_llm_api_key', {
        provider: settings.provider,
        key: apiKey.trim(),
      });

      if (result.ok) {
        setHasKey(true);
        setApiKey('');
        setTestResult({ success: true, message: 'API key saved successfully!' });
      } else {
        setTestResult({ success: false, message: result.error || 'Failed to save key' });
      }
    } catch (e) {
      setTestResult({ success: false, message: String(e) });
    } finally {
      setIsLoading(false);
    }
  };
  


  const handleClearKey = async () => {
    setIsLoading(true);
    try {
      await invoke('clear_llm_api_key', { provider: settings.provider });
      setHasKey(false);
      setTestResult({ success: true, message: 'API key cleared' });
    } catch (e) {
      setTestResult({ success: false, message: String(e) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTest = async () => {
    setIsLoading(true);
    setTestResult(null);

    try {
      // For cloud providers, check if key exists
      if (providerRequiresApiKey(settings.provider)) {
        const has = await invoke<boolean>('has_llm_api_key', { provider: settings.provider });
        if (!has) {
          setTestResult({ success: false, message: 'No API key configured. Please enter and save your key first.' });
          return;
        }
      }

      // Test the connection with a simple ask_user request (no screenshot needed)
      const result = await invoke<{ proposal: { kind: string } } | { code: string; message: string }>(
        'llm_propose_next_action',
        {
          params: {
            provider: settings.provider,
            baseUrl: settings.baseUrl,
            model: settings.model,
            goal: 'Test connection',
            screenshotPngBase64: null,
            history: null,
            constraints: { maxActions: 1, maxRuntimeMinutes: 1 },
          },
        }
      );

      if ('proposal' in result) {
        setTestResult({ success: true, message: 'Connection successful! LLM is responding.' });
      } else {
        setTestResult({ success: false, message: `Error: ${result.message}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('NO_API_KEY')) {
        setTestResult({ success: false, message: 'No API key configured. Please enter and save your key first.' });
      } else if (msg.includes('CONNECTION_FAILED') || msg.includes('Connection refused') || msg.includes('Failed to connect')) {
        setTestResult({ 
          success: false, 
          message: settings.provider === 'native_qwen_ollama'
            ? `Free AI is not ready at ${settings.baseUrl}. Use Start Free AI in the main assistant view, or ensure your existing local Ollama service is running with ${settings.model}.`
            : settings.provider === 'openai_compat'
              ? 'Local server not reachable. Ensure your local LLM server is running at ' + settings.baseUrl + ' and try again.'
              : `Connection failed: ${msg}`
        });
      } else if (msg.includes('TIMEOUT')) {
        setTestResult({ 
          success: false, 
          message: 'Request timed out. The local server may be overloaded or not responding.'
        });
      } else {
        setTestResult({ success: false, message: `Test failed: ${msg}` });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const detectUpdateTarget = async (): Promise<{ platform: string; arch: string; currentVersion: string }> => {
    const currentVersion = await getVersion();
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = userAgent.includes('win') ? 'windows' : 'darwin';
    const arch = platform === 'windows'
      ? 'x86_64'
      : userAgent.includes('arm') || userAgent.includes('aarch64') || userAgent.includes('apple')
      ? 'aarch64'
      : 'x86_64';

    return { platform, arch, currentVersion };
  };

  const handleCheckForUpdates = async () => {
    setIsLoading(true);
    setUpdateResult(null);

    try {
      if (!UPDATER_ENABLED) {
        setUpdateResult({ success: true, message: 'Updater is disabled in this environment.' });
        return;
      }

      if (!apiHttpBase) {
        throw new Error(runtimeConfigError || 'Desktop API configuration is invalid. Refusing to check updates.');
      }

      const target = await detectUpdateTarget();
      const response = await fetch(
        `${apiHttpBase}/updates/desktop/${target.platform}/${target.arch}/${encodeURIComponent(target.currentVersion)}.json`
      );

      if (!response.ok) {
        throw new Error(`Update feed unavailable (${response.status})`);
      }

      const manifest = await response.json() as { version?: string; notes?: string };
      if (!manifest.version || manifest.version === target.currentVersion) {
        setUpdateResult({ success: true, message: 'You are up to date.' });
        return;
      }

      setUpdateResult({
        success: true,
        message: `Update available: ${manifest.version}${manifest.notes ? ` - ${manifest.notes}` : ''}`,
      });
    } catch (e) {
      setUpdateResult({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          padding: '2rem',
          width: '90%',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <BrandWordmark width={150} subtitle="Desktop settings" />
          <button
            onClick={() => {
              onClose();
            }}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: '#666',
            }}
          >
            ×
          </button>
        </div>

        {/* AI Assist Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            🤖 AI Assist Configuration
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            Configure the assistant model. Local Qwen via Ollama is the free default. API keys stay in the OS keychain and are never sent to the server.
          </p>

          {/* Provider */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: '#333' }}>
              Provider
            </label>
            <select
              value={settings.provider}
              onChange={(e) => {
                const newProvider = e.target.value as LlmProvider;
                onLlmSettingsChange(getLlmDefaults(newProvider));
                void checkApiKey(newProvider);
              }}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd',
                fontSize: '0.875rem',
              }}
            >
              {supportedProviders.map((provider) => (
                <option key={provider.provider} value={provider.provider}>
                  {provider.label}
                  {provider.paid ? ' (paid)' : provider.provider === 'native_qwen_ollama' ? ' (free default)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: '#333' }}>
              Base URL
            </label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => onLlmSettingsChange({ ...settings, baseUrl: e.target.value })}
              placeholder={providerDefinition.baseUrl}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd',
                fontSize: '0.875rem',
              }}
            />
          </div>

          {/* Model */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: '#333' }}>
              Model
            </label>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => onLlmSettingsChange({ ...settings, model: e.target.value })}
              placeholder={providerDefinition.model}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd',
                fontSize: '0.875rem',
              }}
            />
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
              Default: {providerDefinition.model}
            </p>
          </div>

          {/* API Key - only show for cloud providers */}
          {providerRequiresApiKey(settings.provider) && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: '#333' }}>
              API Key {hasKey && <span style={{ color: '#10b981' }}>✓ Saved</span>}
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••••••••••' : 'Enter your API key'}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  fontSize: '0.875rem',
                }}
              />
              <button
                onClick={handleSaveKey}
                disabled={!apiKey.trim() || isLoading}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: apiKey.trim() ? '#0070f3' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '0.875rem',
                }}
              >
                Save
              </button>
              {hasKey && (
                <button
                  onClick={handleClearKey}
                  disabled={isLoading}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
              Stored securely in your OS keychain. Never sent to the server.
            </p>
          </div>
          )}

          {isPaidLlmProvider(settings.provider) && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem',
                backgroundColor: '#fff7ed',
                border: '1px solid #fdba74',
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: '#9a3412',
              }}
            >
              <strong>Paid provider</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                {providerDefinition.billingHint || 'Charges may apply on your provider account. Keep the selected model aligned with your budget.'}
              </p>
            </div>
          )}
          
          {/* Local server note */}
          {settings.provider === 'native_qwen_ollama' && (
            <div style={{ 
              marginBottom: '1rem', 
              padding: '0.75rem', 
              backgroundColor: '#ecfeff', 
              border: '1px solid #a5f3fc',
              borderRadius: '4px',
              fontSize: '0.875rem',
              color: '#155e75',
            }}>
              <strong>{getLlmProviderLabel(settings.provider)} setup</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                Install and start Ollama, then run <code>ollama pull {settings.model}</code>. The desktop will connect directly to your local Ollama server at {settings.baseUrl}.
              </p>
            </div>
          )}

          {settings.provider === 'openai_compat' && (
            <div style={{ 
              marginBottom: '1rem', 
              padding: '0.75rem', 
              backgroundColor: '#f0f9ff', 
              border: '1px solid #bae6fd',
              borderRadius: '4px',
              fontSize: '0.875rem',
              color: '#0369a1',
            }}>
              <strong>Local Model Setup Required</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                You need to run a local OpenAI-compatible server (e.g., vLLM, llama.cpp server) 
                on your machine. See documentation for setup instructions.
              </p>
            </div>
          )}

          {(settings.provider === 'deepseek' || settings.provider === 'minimax' || settings.provider === 'kimi') && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: '#1d4ed8',
              }}
            >
              <strong>{providerDefinition.label} compatibility</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                {providerDefinition.setupHint} The desktop uses your configured base URL and API key directly; no provider traffic is proxied through the server.
              </p>
            </div>
          )}

          {settings.provider === 'claude' && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem',
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: '#334155',
              }}
            >
              <strong>{providerDefinition.label} setup</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                {providerDefinition.setupHint} The desktop uses Anthropic&apos;s Messages API directly from the local app.
              </p>
            </div>
          )}

          {/* Test Button */}
          <button
            onClick={handleTest}
            disabled={isLoading || (providerRequiresApiKey(settings.provider) && !hasKey)}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: (!providerRequiresApiKey(settings.provider) || hasKey) ? '#10b981' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (!providerRequiresApiKey(settings.provider) || hasKey) ? 'pointer' : 'not-allowed',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            {isLoading ? 'Testing...' : 'Test Connection'}
          </button>

          {/* Test Result */}
          {testResult && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: testResult.success ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${testResult.success ? '#86efac' : '#fecaca'}`,
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: testResult.success ? '#166534' : '#991b1b',
              }}
            >
              {testResult.message}
            </div>
          )}
        </div>

        {/* Workspace Section */}
        <div style={{ marginBottom: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            📁 Workspace Configuration
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            Choose a workspace folder for AI tool operations. The AI will only be able to access files within this folder.
          </p>

          {/* Workspace Status */}
          <div style={{ marginBottom: '1rem' }}>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: workspaceState.configured ? '#f0fdf4' : '#f3f4f6',
                border: `1px solid ${workspaceState.configured ? '#86efac' : '#d1d5db'}`,
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#333' }}>
                  {workspaceState.configured ? '✓ Workspace configured' : 'Workspace not set'}
                </div>
                {workspaceState.configured && workspaceState.rootName && (
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                    Folder: <code>{workspaceState.rootName}</code>
                  </div>
                )}
              </div>
              {workspaceState.configured && (
                <button
                  onClick={handleClearWorkspace}
                  disabled={isLoadingWorkspace}
                  style={{
                    padding: '0.375rem 0.75rem',
                    backgroundColor: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Choose Folder Button */}
          {!workspaceState.configured && (
            <button
              onClick={handleChooseWorkspace}
              disabled={isLoadingWorkspace}
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#0070f3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              {isLoadingWorkspace ? 'Loading...' : 'Choose Workspace Folder...'}
            </button>
          )}

          <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#666' }}>
            The absolute path is never sent to the server. Only the folder name is shared.
          </p>
        </div>

        {/* Background Section */}
        <div style={{ marginBottom: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            🧭 Background
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            Closing the main window hides the app to the tray. Use the tray menu to reopen it or quit fully.
          </p>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.75rem 0',
            }}
          >
            <span style={{ fontSize: '0.875rem', color: '#333' }}>Start minimized to tray</span>
            <input
              type="checkbox"
              checked={localSettings.startMinimizedToTray}
              onChange={(e) => onStartMinimizedChange(e.target.checked)}
            />
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.75rem 0',
              borderTop: '1px solid #f3f4f6',
            }}
          >
            <span style={{ fontSize: '0.875rem', color: '#333' }}>
              Launch at startup {autostartSupported ? '' : '(unsupported on this OS)'}
            </span>
            <input
              type="checkbox"
              checked={localSettings.autostartEnabled}
              disabled={!autostartSupported || autostartBusy}
              onChange={(e) => onAutostartChange(e.target.checked)}
            />
          </label>

          {!autostartSupported && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#9a3412' }}>
              Autostart is currently supported on macOS and Windows builds.
            </p>
          )}
          {autostartError && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#b91c1c' }}>
              {autostartError}
            </p>
          )}
        </div>

        {/* Quick Toggles Section */}
        <div style={{ marginBottom: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            ⚡ Quick Toggles
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            These match the tray menu and the main panel toggles. Both remain opt-in and visible.
          </p>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.75rem 0',
            }}
          >
            <span style={{ fontSize: '0.875rem', color: '#333' }}>Share screen preview</span>
            <input
              type="checkbox"
              checked={localSettings.screenPreviewEnabled}
              onChange={(e) => onScreenPreviewToggle(e.target.checked)}
            />
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.75rem 0',
              borderTop: '1px solid #f3f4f6',
            }}
          >
            <span style={{ fontSize: '0.875rem', color: '#333' }}>Allow control</span>
            <input
              type="checkbox"
              checked={localSettings.allowControlEnabled}
              onChange={(e) => onAllowControlToggle(e.target.checked)}
            />
          </label>
        </div>

        {/* Permissions Section */}
        <div style={{ marginBottom: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            🔐 Permissions
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            Screen preview depends on Screen Recording permission. Remote control depends on Accessibility permission.
          </p>

          <div
            style={{
              padding: '0.75rem',
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#333' }}>Screen Recording</div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: permissionStatus.screenRecording === 'granted' ? '#166534' : permissionStatus.screenRecording === 'denied' ? '#991b1b' : '#92400e' }}>
                {permissionStatus.screenRecording}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#666', lineHeight: 1.5 }}>
              {screenRecordingInstructions.map((step) => (
                <div key={step}>{step}</div>
              ))}
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  void onOpenPermissionSettings('screenRecording');
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  backgroundColor: '#111827',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                Open Screen Recording Settings
              </button>
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem',
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#333' }}>Accessibility</div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: permissionStatus.accessibility === 'granted' ? '#166534' : permissionStatus.accessibility === 'denied' ? '#991b1b' : '#92400e' }}>
                {permissionStatus.accessibility}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#666', lineHeight: 1.5 }}>
              {accessibilityInstructions.map((step) => (
                <div key={step}>{step}</div>
              ))}
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  void onOpenPermissionSettings('accessibility');
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  backgroundColor: '#111827',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                Open Accessibility Settings
              </button>
              <button
                onClick={() => {
                  void onRefreshPermissionStatus();
                }}
                disabled={permissionStatusBusy}
                style={{
                  padding: '0.5rem 0.75rem',
                  backgroundColor: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  cursor: permissionStatusBusy ? 'not-allowed' : 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                {permissionStatusBusy ? 'Refreshing...' : 'Refresh Status'}
              </button>
            </div>
          </div>

          {permissionHintTarget && permissionHintMessage && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: '#991b1b',
              }}
            >
              Recent issue for <strong>{permissionHintTarget}</strong>: {permissionHintMessage}
            </div>
          )}
        </div>

        {/* Diagnostics Section */}
        <div style={{ marginBottom: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            🧪 Diagnostics
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            Export a redacted support snapshot containing the last 50 approval records and current native permission status.
          </p>
          <button
            onClick={() => {
              void onExportDiagnostics();
            }}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: '#111827',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Export Diagnostics
          </button>
          {diagnosticsStatus && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#166534' }}>
              {diagnosticsStatus}
            </p>
          )}
        </div>

        {/* Updates Section */}
        <div style={{ marginBottom: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            ⬆️ Desktop Updates
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            Signed release builds are configured to use the Tauri updater feed. In development, updater checks can be disabled.
          </p>
          {runtimeConfigError && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: '#991b1b',
              }}
            >
              {runtimeConfigError}
            </div>
          )}
          <button
            onClick={() => {
              void handleCheckForUpdates();
            }}
            disabled={isLoading || !apiHttpBase}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: isLoading || !apiHttpBase ? '#d1d5db' : '#111827',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading || !apiHttpBase ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            {isLoading ? 'Checking...' : 'Check for Updates'}
          </button>
          {updateResult && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: updateResult.success ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${updateResult.success ? '#86efac' : '#fecaca'}`,
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: updateResult.success ? '#166534' : '#991b1b',
              }}
            >
              {updateResult.message}
            </div>
          )}
        </div>

        {/* Close button */}
              <button
                onClick={() => {
                  onClose();
                }}
          style={{
            width: '100%',
            padding: '0.75rem',
            backgroundColor: '#f3f4f6',
            color: '#374151',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
