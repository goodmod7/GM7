import { invoke } from '@tauri-apps/api/core';

export type PermissionStatusValue = 'granted' | 'denied' | 'unknown';
export type PermissionTarget = 'screenRecording' | 'accessibility';

export interface NativePermissionStatus {
  screenRecording: PermissionStatusValue;
  accessibility: PermissionStatusValue;
}

interface KeyResult {
  ok: boolean;
  error?: string;
}

export async function getPermissionStatus(): Promise<NativePermissionStatus> {
  return await invoke<NativePermissionStatus>('permissions_get_status');
}

export async function openPermissionSettings(target: PermissionTarget): Promise<void> {
  const result = await invoke<KeyResult>('permissions_open_settings', { target });
  if (!result.ok) {
    throw new Error(result.error || `Failed to open ${target} settings`);
  }
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');
}

export function getPermissionInstructions(target: PermissionTarget): string[] {
  if (isMac()) {
    if (target === 'screenRecording') {
      return [
        'Open System Settings.',
        'Go to Privacy & Security > Screen Recording.',
        'Enable access for AI Operator Desktop, then restart the app if macOS asks you to.',
      ];
    }

    return [
      'Open System Settings.',
      'Go to Privacy & Security > Accessibility.',
      'Enable access for AI Operator Desktop so it can inject approved input.',
    ];
  }

  if (target === 'screenRecording') {
    return [
      'Screen capture permission checks are best-effort on this platform.',
      'If capture fails, review your OS privacy settings and relaunch the desktop app.',
    ];
  }

  return [
    'Accessibility permission checks are best-effort on this platform.',
    'If input injection fails, review your OS accessibility or input-control settings and relaunch the desktop app.',
  ];
}
