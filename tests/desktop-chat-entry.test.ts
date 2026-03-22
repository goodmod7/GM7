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

test('assistant chat creates an ai_assist run for a confirmed goal when no active run exists', async () => {
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
    'an already-active task should continue without a fresh confirmation gate'
  );
});

test('desktop app seeds the greeting from onboarding copy and keeps fresh chat in intake first', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const chatOverlaySource = readFileSync('apps/desktop/src/components/ChatOverlay.tsx', 'utf8');
  const knowledgeSource = readFileSync('apps/desktop/src/lib/gorkhKnowledge.ts', 'utf8');

  assert.match(knowledgeSource, /GORKH_ONBOARDING/, 'onboarding knowledge should still define greeting copy');
  assert.match(
    appSource,
    /GORKH_ONBOARDING\.(firstGreeting|freeAiNotReady|providerNotConfigured)/,
    'desktop app should seed the first greeting or setup guidance from onboarding copy'
  );
  assert.doesNotMatch(
    appSource,
    /assistantReadiness\.ready[\s\S]{0,500}GORKH_ONBOARDING\.firstGreeting/,
    'local greeting should not be gated on execution readiness checks'
  );
  assert.match(
    appSource,
    /handleSendMessage[\s\S]{0,2400}assistantConversationTurn[\s\S]{0,2400}dispatchConfirmedAssistantTask/,
    'fresh chat should go through assistantConversationTurn before a confirmed task is dispatched'
  );
  assert.doesNotMatch(
    appSource,
    /buildAssistantOpeningGoal|assistantAutoStartAttemptedRef|assistantAutoStartInFlightRef/,
    'desktop app should not keep the hidden assistant warmup-run machinery'
  );
  assert.doesNotMatch(
    appSource,
    /createAssistantTaskConfirmation/,
    'desktop app should derive confirmation from intake output instead of the old deterministic helper'
  );
  assert.match(
    appSource,
    /pendingTaskConfirmation/,
    'desktop app should still keep new tasks behind an explicit confirmation step in chat'
  );
  assert.match(
    appSource,
    /confirm_task|kind === 'reply'|kind === 'confirm_task'/,
    'desktop app should branch on the intake result before deciding whether to stage confirmation'
  );
  assert.match(
    appSource,
    /if \(!trimmed \|\| assistantConversationBusy \|\| pendingTaskConfirmationBusy\)/,
    'desktop app should reject new sends before appending a message when intake or confirmed task start is already busy'
  );
  assert.match(
    appSource,
    /llmSettings\.provider === DEFAULT_LLM_PROVIDER && startingNewTask/,
    'managed local task gating should only run while starting a brand-new confirmed task'
  );
  assert.match(
    appSource,
    /busy=\{assistantConversationBusy \|\| pendingTaskConfirmationBusy\}/,
    'desktop app should pass a busy signal into the chat surface while intake or task start is in flight'
  );
  assert.match(
    chatOverlaySource,
    /pendingTaskConfirmation|onConfirmPendingTask|onCancelPendingTask/,
    'main desktop chat should render explicit proceed and cancel controls while confirmation is pending'
  );
  assert.match(
    chatOverlaySource,
    /busy\?: boolean|busy = false/,
    'chat overlay should accept a busy flag from the app'
  );
  assert.match(
    chatOverlaySource,
    /const canSend = status === 'connected' && !busy && input\.trim\(\)|disabled=\{status !== 'connected' \|\| busy\}/,
    'chat overlay should disable sending while intake or confirmed task start is busy'
  );
});

test('desktop app should stage Free AI setup before first-task intake on the free plan', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const gateIndex = appSource.indexOf('if (!providerConfigured)');
  const conversationIndex = appSource.indexOf('assistantConversationTurn', gateIndex);
  const setupStateIndex = appSource.indexOf('pendingFreeAiSetup', gateIndex);

  assert.notEqual(
    gateIndex,
    -1,
    'desktop app should keep a providerConfigured gate for the free-plan local path'
  );
  assert.notEqual(
    setupStateIndex,
    -1,
    'desktop app should keep a dedicated pending Free AI setup state'
  );
  assert.notEqual(
    conversationIndex,
    -1,
    'desktop app should still contain the assistantConversationTurn intake call'
  );
  assert.ok(
    setupStateIndex < conversationIndex,
    'desktop app should stage pending Free AI setup before assistantConversationTurn in the !providerConfigured path'
  );
  const setupSection = appSource.slice(setupStateIndex, conversationIndex);
  assert.match(
    setupSection,
    /resumeDeferredTaskAfterFreeAiReady|replayDeferredUserTask/,
    'desktop app should resume the deferred task after Free AI is ready'
  );
});
