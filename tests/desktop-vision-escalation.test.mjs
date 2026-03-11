import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appPath = 'apps/desktop/src/App.tsx';
const aiAssistPath = 'apps/desktop/src/lib/aiAssist.ts';
const freeAiSetupCardPath = 'apps/desktop/src/components/FreeAiSetupCard.tsx';
const advancedAgentPath = 'apps/desktop/src-tauri/src/agent/mod.rs';

test('desktop assistant shell surfaces an Enable Vision Boost path for optional local vision setup', () => {
  const appSource = readFileSync(appPath, 'utf8');
  const setupCardSource = readFileSync(freeAiSetupCardPath, 'utf8');

  assert.match(appSource, /resolveManagedLocalTaskBinding/, 'desktop app should evaluate whether a task actually needs vision');
  assert.match(setupCardSource, /Enable Vision Boost/, 'free local AI onboarding should expose an explicit Vision Boost action');
});

test('legacy assistant loop no longer assumes screenshot capture for every task', () => {
  const source = readFileSync(aiAssistPath, 'utf8');

  assert.match(source, /taskLikelyNeedsVision/, 'legacy assistant loop should use a goal-based vision heuristic');
  assert.match(source, /This task needs Vision Boost|vision-capable model/i, 'legacy assistant should explain when a task needs vision support');
});

test('advanced retail assistant no longer unconditionally observes the screen for every step', () => {
  const source = readFileSync(advancedAgentPath, 'utf8');

  assert.match(source, /task_needs_vision/, 'advanced agent should gate screenshot observation behind a vision heuristic');
  assert.match(source, /ScreenObservation::empty\(\)/, 'advanced agent should keep a text-first path when vision is not required');
});
