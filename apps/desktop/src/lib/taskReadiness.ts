import type { RunMode } from '@ai-operator/shared';
import type { LocalSettingsState } from './localSettings.js';
import type { NativePermissionStatus } from './permissions.js';

export type DesktopTaskBlockerId =
  | 'screen-preview'
  | 'screen-permission'
  | 'control-toggle'
  | 'accessibility-permission'
  | 'workspace'
  | 'provider';

export interface DesktopTaskBlocker {
  id: DesktopTaskBlockerId;
  label: string;
  detail: string;
}

export interface DesktopTaskReadiness {
  ready: boolean;
  blockers: DesktopTaskBlocker[];
}

interface EvaluateDesktopTaskReadinessInput {
  mode: RunMode;
  subscriptionStatus: 'active' | 'inactive';
  permissionStatus: NativePermissionStatus;
  localSettings: LocalSettingsState;
  workspaceConfigured: boolean;
  providerConfigured: boolean;
}

export function evaluateDesktopTaskReadiness(
  input: EvaluateDesktopTaskReadinessInput
): DesktopTaskReadiness {
  const blockers: DesktopTaskBlocker[] = [];

  if (!input.localSettings.screenPreviewEnabled) {
    blockers.push({
      id: 'screen-preview',
      label: 'Screen preview disabled',
      detail: 'Enable Screen Preview so runs can inspect the local desktop safely.',
    });
  }

  if (input.permissionStatus.screenRecording !== 'granted') {
    blockers.push({
      id: 'screen-permission',
      label: 'Screen recording permission missing',
      detail: 'Grant screen recording permission for this desktop app.',
    });
  }

  if (!input.localSettings.allowControlEnabled) {
    blockers.push({
      id: 'control-toggle',
      label: 'Allow Control disabled',
      detail: 'Enable Allow Control so approved actions can execute locally.',
    });
  }

  if (input.permissionStatus.accessibility !== 'granted') {
    blockers.push({
      id: 'accessibility-permission',
      label: 'Accessibility permission missing',
      detail: 'Grant accessibility/input permission for approved desktop actions.',
    });
  }

  if (input.mode === 'ai_assist' && !input.workspaceConfigured) {
    blockers.push({
      id: 'workspace',
      label: 'Workspace not configured',
      detail: 'Choose a workspace folder before starting AI Assist tasks.',
    });
  }

  if (input.mode === 'ai_assist' && !input.providerConfigured) {
    blockers.push({
      id: 'provider',
      label: 'Provider not configured',
      detail: 'Configure a usable model provider before starting AI Assist tasks.',
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}
