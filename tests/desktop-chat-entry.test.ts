import assert from 'node:assert/strict';
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
