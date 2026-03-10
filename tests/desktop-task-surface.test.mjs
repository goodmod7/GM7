import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appPath = 'apps/desktop/src/App.tsx';
const runPanelPath = 'apps/desktop/src/components/RunPanel.tsx';
const helperPath = 'apps/desktop/src/lib/desktopTasks.ts';
const accountHelperPath = 'apps/desktop/src/lib/desktopAccount.ts';

test('desktop primary surface exposes a local task composer, readiness panel, approvals panel, and task history', () => {
  const source = readFileSync(appPath, 'utf8');

  assert.match(source, /Readiness/i, 'desktop should show a readiness panel');
  assert.match(source, /Pending Approvals/i, 'desktop should show a visible approvals panel');
  assert.match(source, /Recent Tasks/i, 'desktop should show recent task history');
  assert.match(source, /Create Task|Start Task/i, 'desktop should expose a primary task composer');
});

test('desktop task helper uses desktop-authenticated bootstrap and run creation endpoints', () => {
  const source = readFileSync(helperPath, 'utf8');

  assert.match(source, /\/desktop\/me/, 'desktop should bootstrap the signed-in task surface from the desktop API');
  assert.match(source, /\/desktop\/runs/, 'desktop should create runs directly through the desktop API');
});

test('desktop surface exposes account and device session management helpers', () => {
  const appSource = readFileSync(appPath, 'utf8');
  const helperSource = readFileSync(accountHelperPath, 'utf8');

  assert.match(appSource, /Account & Devices|Device Sessions/i, 'desktop should expose account/device management on the primary surface');
  assert.match(helperSource, /\/desktop\/account/, 'desktop should load desktop account/device state from the desktop API');
  assert.match(helperSource, /\/desktop\/devices\/\$\{deviceId\}\/revoke/, 'desktop should support remote desktop session revoke');
});

test('desktop run panel no longer tells users to create runs from the web dashboard', () => {
  const source = readFileSync(runPanelPath, 'utf8');

  assert.doesNotMatch(
    source,
    /Create a run from the web dashboard/,
    'desktop-first flow should not direct the primary run path back to the dashboard'
  );
});
