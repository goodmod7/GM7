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

export type DesktopTaskSetupItemId =
  | DesktopTaskBlockerId
  | 'local-engine'
  | 'vision-boost';

export interface DesktopTaskBlocker {
  id: DesktopTaskBlockerId;
  label: string;
  detail: string;
}

export interface DesktopTaskSetupItem {
  id: DesktopTaskSetupItemId;
  label: string;
  detail: string;
}

export interface DesktopTaskReadiness {
  ready: boolean;
  blockers: DesktopTaskBlocker[];
  requiredSetup: DesktopTaskSetupItem[];
  optionalUpgrades: DesktopTaskSetupItem[];
}

interface EvaluateDesktopTaskReadinessInput {
  mode: RunMode;
  subscriptionStatus: 'active' | 'inactive';
  permissionStatus: NativePermissionStatus;
  localSettings: LocalSettingsState;
  workspaceConfigured: boolean;
  providerConfigured: boolean;
  isManagedLocalProvider?: boolean;
}

export function evaluateDesktopTaskReadiness(
  input: EvaluateDesktopTaskReadinessInput
): DesktopTaskReadiness {
  const blockers: DesktopTaskBlocker[] = [];
  const requiredSetup: DesktopTaskSetupItem[] = [];
  const optionalUpgrades: DesktopTaskSetupItem[] = [];

  if (!input.localSettings.screenPreviewEnabled) {
    const item = {
      id: 'screen-preview',
      label: 'Screen preview disabled',
      detail: 'Enable Screen Preview so runs can inspect the local desktop safely.',
    } satisfies DesktopTaskBlocker;
    blockers.push(item);
    requiredSetup.push(item);
  }

  if (input.permissionStatus.screenRecording !== 'granted') {
    const item = {
      id: 'screen-permission',
      label: 'Screen recording permission missing',
      detail: 'Grant screen recording permission for this desktop app.',
    } satisfies DesktopTaskBlocker;
    blockers.push(item);
    requiredSetup.push(item);
  }

  if (!input.localSettings.allowControlEnabled) {
    const item = {
      id: 'control-toggle',
      label: 'Allow Control disabled',
      detail: 'Enable Allow Control so approved actions can execute locally.',
    } satisfies DesktopTaskBlocker;
    blockers.push(item);
    requiredSetup.push(item);
  }

  if (input.permissionStatus.accessibility !== 'granted') {
    const item = {
      id: 'accessibility-permission',
      label: 'Accessibility permission missing',
      detail: 'Grant accessibility/input permission for approved desktop actions.',
    } satisfies DesktopTaskBlocker;
    blockers.push(item);
    requiredSetup.push(item);
  }

  if (input.mode === 'ai_assist' && !input.workspaceConfigured) {
    const item = {
      id: 'workspace',
      label: 'Workspace not configured',
      detail: 'Choose a workspace folder before starting AI Assist tasks.',
    } satisfies DesktopTaskBlocker;
    blockers.push(item);
    requiredSetup.push(item);
  }

  if (input.mode === 'ai_assist' && !input.providerConfigured) {
    const item = {
      id: 'provider',
      label: 'Provider not configured',
      detail: 'Configure a usable model provider before starting AI Assist tasks.',
    } satisfies DesktopTaskBlocker;
    blockers.push(item);
    requiredSetup.push(
      input.isManagedLocalProvider === false
        ? item
        : {
            id: 'local-engine',
            label: 'Free AI not ready',
            detail: 'Install the local engine and default AI model before starting assistant work.',
          }
    );
  }

  return {
    ready: requiredSetup.length === 0,
    blockers,
    requiredSetup,
    optionalUpgrades,
  };
}
