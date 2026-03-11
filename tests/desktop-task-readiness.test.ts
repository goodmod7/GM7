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
