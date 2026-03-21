import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface MinimalRun {
  runId: string;
  goal: string;
  status: 'queued' | 'running' | 'waiting_for_user' | 'done' | 'failed' | 'canceled';
  createdAt: number;
  updatedAt: number;
  deviceId: string;
  steps: [];
}

test('assistant chat reuses an active run before sending a message', async () => {
  let imported: typeof import('../apps/desktop/src/lib/chatTaskFlow.ts');
  try {
    imported = await import('../apps/desktop/src/lib/chatTaskFlow.ts');
  } catch {
    assert.fail('chat task flow helper should exist');
    return;
  }

  const activeRun: MinimalRun = {
    runId: 'run-active',
    goal: 'Existing task',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    deviceId: 'device-1',
    steps: [],
  };

  let createCalls = 0;
  const run = await imported.ensureAssistantRunForMessage({
    message: 'Keep going',
    activeRun,
    runtimeConfig: { httpBase: 'http://localhost:3001', wsUrl: 'ws://localhost:3001/ws' },
    deviceToken: 'desktop-token',
    createRun: async () => {
      createCalls += 1;
      return activeRun as never;
    },
  });

  assert.equal(run.runId, 'run-active');
  assert.equal(createCalls, 0, 'existing active run should be reused');
});

test('assistant chat creates a hidden ai_assist run from the first message when no active run exists', async () => {
  let imported: typeof import('../apps/desktop/src/lib/chatTaskFlow.ts');
  try {
    imported = await import('../apps/desktop/src/lib/chatTaskFlow.ts');
  } catch {
    assert.fail('chat task flow helper should exist');
    return;
  }

  let capturedInput: { goal: string; mode: 'ai_assist' | 'manual' } | null = null;
  const createdRun: MinimalRun = {
    runId: 'run-new',
    goal: 'Fix tests in this repo',
    status: 'queued',
    createdAt: 1,
    updatedAt: 1,
    deviceId: 'device-1',
    steps: [],
  };

  const run = await imported.ensureAssistantRunForMessage({
    message: 'Fix tests in this repo',
    activeRun: null,
    runtimeConfig: { httpBase: 'http://localhost:3001', wsUrl: 'ws://localhost:3001/ws' },
    deviceToken: 'desktop-token',
    createRun: async (_runtimeConfig, _deviceToken, input) => {
      capturedInput = input;
      return createdRun as never;
    },
  });

  assert.equal(run.runId, 'run-new');
  assert.deepEqual(capturedInput, {
    goal: 'Fix tests in this repo',
    mode: 'ai_assist',
  });
});

test('assistant chat decides whether a new request needs explicit confirmation before starting', async () => {
  let imported: typeof import('../apps/desktop/src/lib/chatTaskFlow.ts');
  try {
    imported = await import('../apps/desktop/src/lib/chatTaskFlow.ts');
  } catch {
    assert.fail('chat task flow helper should exist');
    return;
  }

  assert.equal(
    imported.shouldConfirmAssistantTaskStart(null),
    true,
    'a brand new request should require explicit confirmation'
  );

  assert.equal(
    imported.shouldConfirmAssistantTaskStart({
      runId: 'run-active',
      goal: 'Fix tests in this repo',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      deviceId: 'device-1',
      steps: [],
    } as never),
    false,
    'an already-active non-warmup task should continue without a fresh confirmation gate'
  );

  assert.equal(
    imported.shouldConfirmAssistantTaskStart({
      runId: 'run-warmup',
      goal: imported.ASSISTANT_OPENING_GOAL,
      status: 'waiting_for_user',
      createdAt: 1,
      updatedAt: 1,
      deviceId: 'device-1',
      steps: [],
    } as never),
    true,
    'the retail warmup session should still require confirmation before the first real task starts'
  );
});

test('assistant chat builds a plain-language confirmation prompt before a new task starts', async () => {
  let imported: typeof import('../apps/desktop/src/lib/chatTaskFlow.ts');
  try {
    imported = await import('../apps/desktop/src/lib/chatTaskFlow.ts');
  } catch {
    assert.fail('chat task flow helper should exist');
    return;
  }

  const confirmation = imported.createAssistantTaskConfirmation('Fix tests in this repo');

  assert.equal(confirmation.goal, 'Fix tests in this repo');
  assert.match(confirmation.prompt, /I understand you want me to/i);
  assert.match(confirmation.prompt, /Fix tests in this repo/);
  assert.match(confirmation.prompt, /Should I proceed\?/i);
});

test('desktop app keeps new tasks behind an explicit confirmation step in the chat surface', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const chatOverlaySource = readFileSync('apps/desktop/src/components/ChatOverlay.tsx', 'utf8');

  assert.match(
    appSource,
    /pendingTaskConfirmation/,
    'desktop app should track a pending task confirmation before starting a fresh task'
  );
  assert.match(
    appSource,
    /setPendingTaskConfirmation/,
    'desktop app should be able to stage a confirmation prompt before run creation'
  );
  assert.match(
    appSource,
    /shouldConfirmAssistantTaskStart|createAssistantTaskConfirmation/,
    'desktop app should route new-task confirmation through the shared chat task flow helpers'
  );
  assert.match(
    chatOverlaySource,
    /pendingTaskConfirmation|onConfirmPendingTask|onCancelPendingTask/,
    'main desktop chat should render explicit proceed and cancel controls while confirmation is pending'
  );
});
