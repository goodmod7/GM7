import { useState, useEffect, useCallback } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  clearWorkspace,
  configureWorkspace,
  getWorkspaceState,
  type LocalWorkspaceState,
} from '../lib/workspace.js';
import type { LocalSettingsState } from '../lib/localSettings.js';

export interface LlmSettings {
  provider: 'openai';
  baseUrl: string;
  model: string;
}

export type WorkspaceState = LocalWorkspaceState;

const API_HTTP_BASE = import.meta.env.VITE_API_HTTP_BASE || 'http://localhost:3001';
const UPDATER_ENABLED = import.meta.env.VITE_DESKTOP_UPDATER_ENABLED === 'true';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  localSettings: LocalSettingsState;
  autostartSupported: boolean;
  autostartBusy?: boolean;
  autostartError?: string | null;
  onStartMinimizedChange: (enabled: boolean) => void;
  onAutostartChange: (enabled: boolean) => void;
  onScreenPreviewToggle: (enabled: boolean) => void;
  onAllowControlToggle: (enabled: boolean) => void;
  onWorkspaceChange?: (state: WorkspaceState) => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  localSettings,
  autostartSupported,
  autostartBusy = false,
  autostartError,
  onStartMinimizedChange,
  onAutostartChange,
  onScreenPreviewToggle,
  onAllowControlToggle,
  onWorkspaceChange,
}: SettingsPanelProps) {
  const [settings, setSettings] = useState<LlmSettings>({
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4.1-mini',
  });
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [updateResult, setUpdateResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Workspace state
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ configured: false });
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('ai-operator-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings((s) => ({ ...s, ...parsed }));
      } catch {
        // Ignore parse errors
      }
    }

    // Check if API key exists
    checkApiKey();
    
    // Load workspace state
    loadWorkspaceState();
  }, []);
  
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
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Folder',
      });
      
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

  const checkApiKey = async () => {
    try {
      const has = await invoke<boolean>('has_llm_api_key', { provider: 'openai' });
      setHasKey(has);
    } catch (e) {
      console.error('Failed to check API key:', e);
      setHasKey(false);
    }
  };

  const saveSettings = useCallback(() => {
    localStorage.setItem('ai-operator-settings', JSON.stringify(settings));
  }, [settings]);

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
      // Check if key exists first
      const has = await invoke<boolean>('has_llm_api_key', { provider: settings.provider });
      if (!has) {
        setTestResult({ success: false, message: 'No API key configured. Please enter and save your key first.' });
        return;
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

      const target = await detectUpdateTarget();
      const response = await fetch(
        `${API_HTTP_BASE}/updates/desktop/${target.platform}/${target.arch}/${encodeURIComponent(target.currentVersion)}.json`
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
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button
            onClick={() => {
              saveSettings();
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
            Configure your LLM provider for AI Assist mode. Your API key is stored securely in the OS keychain and never sent to the server.
          </p>

          {/* Provider */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: '#333' }}>
              Provider
            </label>
            <select
              value={settings.provider}
              onChange={(e) => setSettings((s) => ({ ...s, provider: e.target.value as 'openai' }))}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd',
                fontSize: '0.875rem',
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic" disabled>Anthropic (coming soon)</option>
              <option value="google" disabled>Google (coming soon)</option>
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
              onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))}
              placeholder="https://api.openai.com"
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
              onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
              placeholder="gpt-4.1-mini"
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd',
                fontSize: '0.875rem',
              }}
            />
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#666' }}>
              Examples: gpt-4.1-mini, gpt-4.1, gpt-4o
            </p>
          </div>

          {/* API Key */}
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

          {/* Test Button */}
          <button
            onClick={handleTest}
            disabled={isLoading || !hasKey}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: hasKey ? '#10b981' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: hasKey ? 'pointer' : 'not-allowed',
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

        {/* Updates Section */}
        <div style={{ marginBottom: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
            ⬆️ Desktop Updates
          </h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            Signed release builds are configured to use the Tauri updater feed. In development, updater checks can be disabled.
          </p>
          <button
            onClick={() => {
              void handleCheckForUpdates();
            }}
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: isLoading ? '#d1d5db' : '#111827',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
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
            saveSettings();
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
