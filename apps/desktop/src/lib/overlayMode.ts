import { invoke } from '@tauri-apps/api/core';

interface KeyResult {
  ok: boolean;
  error?: string;
}

export interface OverlayModeStatus {
  active: boolean;
  supported: boolean;
  lastError?: string | null;
}

async function invokeKeyResult(command: 'main_window_enter_overlay_mode' | 'main_window_exit_overlay_mode'): Promise<void> {
  const result = await invoke<KeyResult>(command);
  if (!result.ok) {
    throw new Error(result.error || `Failed to run ${command}`);
  }
}

export async function getOverlayModeStatus(): Promise<OverlayModeStatus> {
  return await invoke<OverlayModeStatus>('main_window_overlay_status');
}

export async function enterOverlayMode(): Promise<OverlayModeStatus> {
  await invokeKeyResult('main_window_enter_overlay_mode');
  return await getOverlayModeStatus();
}

export async function exitOverlayMode(): Promise<OverlayModeStatus> {
  await invokeKeyResult('main_window_exit_overlay_mode');
  return await getOverlayModeStatus();
}
