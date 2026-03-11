import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDesktopTaskReadiness } from '../apps/desktop/src/lib/taskReadiness.ts';

test('ai assist readiness reports local blockers without treating billing as a hard stop for free local AI', () => {
  const readiness = evaluateDesktopTaskReadiness({
    mode: 'ai_assist',
    subscriptionStatus: 'inactive',
    permissionStatus: {
      screenRecording: 'denied',
      accessibility: 'denied',
    },
    localSettings: {
      startMinimizedToTray: false,
      autostartEnabled: false,
      screenPreviewEnabled: false,
      allowControlEnabled: false,
    },
    workspaceConfigured: false,
    providerConfigured: false,
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(
    readiness.blockers.map((blocker) => blocker.id),
    ['screen-preview', 'screen-permission', 'control-toggle', 'accessibility-permission', 'workspace', 'provider']
  );
});

test('manual desktop runs ignore provider and workspace blockers and only require local control readiness', () => {
  const readiness = evaluateDesktopTaskReadiness({
    mode: 'manual',
    subscriptionStatus: 'active',
    permissionStatus: {
      screenRecording: 'granted',
      accessibility: 'granted',
    },
    localSettings: {
      startMinimizedToTray: false,
      autostartEnabled: false,
      screenPreviewEnabled: false,
      allowControlEnabled: true,
    },
    workspaceConfigured: false,
    providerConfigured: false,
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(
    readiness.blockers.map((blocker) => blocker.id),
    ['screen-preview']
  );
});

test('desktop task readiness becomes ready when local permissions, workspace, and provider are satisfied even on the free plan', () => {
  const readiness = evaluateDesktopTaskReadiness({
    mode: 'ai_assist',
    subscriptionStatus: 'inactive',
    permissionStatus: {
      screenRecording: 'granted',
      accessibility: 'granted',
    },
    localSettings: {
      startMinimizedToTray: false,
      autostartEnabled: false,
      screenPreviewEnabled: true,
      allowControlEnabled: true,
    },
    workspaceConfigured: true,
    providerConfigured: true,
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockers, []);
});

test('desktop retail readiness separates required setup from optional upgrades and avoids provider jargon', () => {
  const readiness = evaluateDesktopTaskReadiness({
    mode: 'ai_assist',
    subscriptionStatus: 'inactive',
    permissionStatus: {
      screenRecording: 'denied',
      accessibility: 'denied',
    },
    localSettings: {
      startMinimizedToTray: false,
      autostartEnabled: false,
      screenPreviewEnabled: false,
      allowControlEnabled: false,
    },
    workspaceConfigured: false,
    providerConfigured: false,
  }) as typeof evaluateDesktopTaskReadiness extends (...args: any[]) => infer TResult
    ? TResult & {
        requiredSetup?: Array<{ id: string }>;
        optionalUpgrades?: Array<{ id: string }>;
      }
    : never;

  assert.equal(Array.isArray(readiness.requiredSetup), true, 'retail onboarding should expose required setup items');
  assert.equal(Array.isArray(readiness.optionalUpgrades), true, 'retail onboarding should expose optional upgrade items separately');
  assert.deepEqual(
    readiness.requiredSetup?.map((item) => item.id),
    ['screen-preview', 'screen-permission', 'control-toggle', 'accessibility-permission', 'workspace', 'local-engine']
  );
  assert.deepEqual(
    readiness.optionalUpgrades?.map((item) => item.id),
    [],
    'the free retail path should keep optional upgrades out of the required setup list'
  );
});

test('desktop custom-provider readiness keeps paid-provider setup separate from Free AI local-engine setup', () => {
  const readiness = evaluateDesktopTaskReadiness({
    mode: 'ai_assist',
    subscriptionStatus: 'active',
    permissionStatus: {
      screenRecording: 'granted',
      accessibility: 'granted',
    },
    localSettings: {
      startMinimizedToTray: false,
      autostartEnabled: false,
      screenPreviewEnabled: true,
      allowControlEnabled: true,
    },
    workspaceConfigured: true,
    providerConfigured: false,
    isManagedLocalProvider: false,
  }) as typeof evaluateDesktopTaskReadiness extends (...args: any[]) => infer TResult
    ? TResult & {
        requiredSetup?: Array<{ id: string; detail: string }>;
      }
    : never;

  assert.deepEqual(
    readiness.requiredSetup?.map((item) => item.id),
    ['provider'],
    'custom provider setup should keep its own readiness item instead of forcing Free AI local-engine setup'
  );
  assert.match(
    readiness.requiredSetup?.[0]?.detail ?? '',
    /configure a usable model provider/i,
    'custom provider setup should direct the user back to provider configuration'
  );
});
