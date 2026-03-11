import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appPath = 'apps/desktop/src/App.tsx';
const helperPath = 'apps/desktop/src/lib/desktopTasks.ts';
const accountHelperPath = 'apps/desktop/src/lib/desktopAccount.ts';

test('desktop primary surface exposes an assistant-first shell instead of a run-first task composer', () => {
  const source = readFileSync(appPath, 'utf8');

  assert.match(source, /Start Free AI|Set up Free AI/i, 'desktop retail shell should make the free local setup path visible');
  assert.match(source, /Free plan|Plus plan|unlimited local tasks|Vision Boost/i, 'desktop retail shell should reflect the free-vs-plus local AI posture');
  assert.match(source, /Settings & details|Debug view|Diagnostics/i, 'desktop should demote technical run details to a secondary view');
  assert.match(source, /ensureAssistantRunForMessage/, 'desktop chat entry should create or resume a hidden run');
  assert.doesNotMatch(source, /Create Task|Start Task|Manual launch/i, 'desktop retail surface should not lead with explicit task creation');
  assert.doesNotMatch(source, /Recent Tasks|Task history/i, 'desktop retail surface should not lead with run history language');
});


test('desktop task helper still uses desktop-authenticated bootstrap and run creation endpoints', () => {
  const source = readFileSync(helperPath, 'utf8');

  assert.match(source, /\/desktop\/me/, 'desktop should bootstrap the signed-in task surface from the desktop API');
  assert.match(source, /\/desktop\/runs/, 'desktop should create runs directly through the desktop API');
});

test('desktop retains desktop account and device session management helpers while retail UX is simplified', () => {
  const helperSource = readFileSync(accountHelperPath, 'utf8');

  assert.match(helperSource, /\/desktop\/account/, 'desktop should load desktop account/device state from the desktop API');
  assert.match(helperSource, /\/desktop\/devices\/\$\{deviceId\}\/revoke/, 'desktop should support remote desktop session revoke');
});
