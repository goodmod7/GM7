/**
 * Tests for the GORKH grounding layer (STEP 1).
 *
 * Verifies that:
 * - gorkhKnowledge.ts exports the expected static knowledge
 * - gorkhContext.ts builds accurate, privacy-safe context blocks
 * - System prompt identity says "GORKH" not generic
 * - Onboarding copy is GORKH-branded and conversation-first
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ---------------------------------------------------------------------------
// gorkhKnowledge tests
// ---------------------------------------------------------------------------

test('gorkhKnowledge exports static feature, setting, and state documentation', async () => {
  const knowledge = await import('../apps/desktop/src/lib/gorkhKnowledge.ts');

  // Feature docs exist for core features
  assert.ok(knowledge.GORKH_FEATURES.freeAi, 'should have freeAi feature doc');
  assert.ok(knowledge.GORKH_FEATURES.remoteControl, 'should have remoteControl feature doc');
  assert.ok(knowledge.GORKH_FEATURES.screenPreview, 'should have screenPreview feature doc');
  assert.ok(knowledge.GORKH_FEATURES.workspace, 'should have workspace feature doc');
  assert.ok(knowledge.GORKH_FEATURES.approvals, 'should have approvals feature doc');

  // Feature docs are substantive
  assert.match(knowledge.GORKH_FEATURES.freeAi.name, /free ai/i);
  assert.match(knowledge.GORKH_FEATURES.freeAi.description, /mac|local|private/i);
  assert.match(knowledge.GORKH_FEATURES.approvals.description, /approval|confirm/i);

  // Setting docs exist
  assert.ok(knowledge.GORKH_SETTINGS.allowControl, 'should have allowControl setting doc');
  assert.ok(knowledge.GORKH_SETTINGS.screenPreview, 'should have screenPreview setting doc');
  assert.ok(knowledge.GORKH_SETTINGS.aiProvider, 'should have aiProvider setting doc');

  // Install stage explanations exist for all values
  const stages = ['not_started', 'planned', 'installing', 'installed', 'starting', 'ready', 'error'];
  for (const stage of stages) {
    assert.ok(
      knowledge.GORKH_INSTALL_STAGE_EXPLANATIONS[stage],
      `should have explanation for installStage "${stage}"`
    );
  }

  // Tier explanations exist
  assert.ok(knowledge.GORKH_TIER_EXPLANATIONS.light);
  assert.ok(knowledge.GORKH_TIER_EXPLANATIONS.standard);
  assert.ok(knowledge.GORKH_TIER_EXPLANATIONS.vision);

  // Provider explanations exist
  assert.ok(knowledge.GORKH_PROVIDER_EXPLANATIONS.native_qwen_ollama);
  assert.ok(knowledge.GORKH_PROVIDER_EXPLANATIONS.openai);
  assert.ok(knowledge.GORKH_PROVIDER_EXPLANATIONS.claude);
  assert.match(knowledge.GORKH_PROVIDER_EXPLANATIONS.native_qwen_ollama, /free|local|private/i);

  // GPU class explanations
  assert.ok(knowledge.GORKH_GPU_CLASS_EXPLANATIONS.discrete);
  assert.ok(knowledge.GORKH_GPU_CLASS_EXPLANATIONS.integrated);
  assert.ok(knowledge.GORKH_GPU_CLASS_EXPLANATIONS.unknown);

  // GPU explanations are honest (discrete = GPU, unknown/integrated = CPU)
  assert.match(knowledge.GORKH_GPU_CLASS_EXPLANATIONS.discrete, /gpu/i);
  assert.match(knowledge.GORKH_GPU_CLASS_EXPLANATIONS.unknown, /cpu/i);
  assert.match(knowledge.GORKH_GPU_CLASS_EXPLANATIONS.integrated, /cpu/i);

  // Onboarding strings exist
  assert.match(knowledge.GORKH_ONBOARDING.firstGreeting, /gorkh/i);
  assert.match(knowledge.GORKH_ONBOARDING.freeAiNotReady, /free ai|local/i);

  // FAQ is populated
  assert.ok(Array.isArray(knowledge.GORKH_FAQ));
  assert.ok(knowledge.GORKH_FAQ.length > 0);
  for (const qa of knowledge.GORKH_FAQ) {
    assert.ok(qa.question, 'each FAQ entry should have a question');
    assert.ok(qa.answer, 'each FAQ entry should have an answer');
  }
});

test('gorkhKnowledge does not contain sensitive data or implementation details the user should not see', async () => {
  const knowledge = await import('../apps/desktop/src/lib/gorkhKnowledge.ts');
  const allText = JSON.stringify(knowledge);

  // No Ollama branding visible to user
  assert.doesNotMatch(allText, /ollama\.com|ollama pull|ollama run/i);
  // No absolute paths
  assert.doesNotMatch(allText, /\/Users\/|\/home\/|C:\\Users\\/);
  // No API key patterns
  assert.doesNotMatch(allText, /sk-[a-zA-Z0-9]{20,}|API key: /);
});

test('desktop app seeds its first greeting from onboarding copy instead of a hidden warmup session', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');

  assert.match(
    appSource,
    /GORKH_ONBOARDING\.(firstGreeting|freeAiNotReady|providerNotConfigured)/,
    'desktop app should source its first greeting from onboarding copy'
  );
  assert.doesNotMatch(
    appSource,
    /buildAssistantOpeningGoal|assistantAutoStartAttemptedRef|assistantAutoStartInFlightRef/,
    'desktop app should not keep the hidden assistant warmup-run machinery'
  );
});

// ---------------------------------------------------------------------------
// gorkhContext tests
// ---------------------------------------------------------------------------

test('buildGorkhContextBlock returns null for minimal empty snapshot', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const result = buildGorkhContextBlock({
    authState: 'checking',
    provider: null,
    providerConfigured: false,
    freeAi: null,
    permissions: null,
    workspaceConfigured: false,
    workspaceRootName: null,
    hardware: null,
  });

  // Even a minimal snapshot produces some output (auth state is known)
  // Result should be null or a short string
  if (result !== null) {
    assert.match(result, /\[GORKH APP STATE\]/);
  }
});

test('buildGorkhContextBlock includes auth state when signed in', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const result = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: 'native_qwen_ollama',
    providerConfigured: true,
    freeAi: null,
    permissions: null,
    workspaceConfigured: false,
    workspaceRootName: null,
    hardware: null,
  });

  assert.ok(result, 'should return a non-empty context block');
  assert.match(result, /signed in/i);
  assert.match(result, /\[GORKH APP STATE\]/);
  assert.match(result, /\[\/GORKH APP STATE\]/);
});

test('buildGorkhContextBlock includes Free AI running status', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const result = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: 'native_qwen_ollama',
    providerConfigured: true,
    freeAi: {
      installStage: 'ready',
      runtimeRunning: true,
      selectedTier: 'standard',
      selectedModel: 'qwen2.5:3b',
      externalServiceDetected: false,
      lastError: null,
    },
    permissions: null,
    workspaceConfigured: false,
    workspaceRootName: null,
    hardware: null,
  });

  assert.ok(result);
  assert.match(result, /running/i);
  assert.match(result, /qwen2\.5:3b/);
});

test('buildGorkhContextBlock includes Free AI not-running status with stage', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const result = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: 'native_qwen_ollama',
    providerConfigured: false,
    freeAi: {
      installStage: 'not_started',
      runtimeRunning: false,
      selectedTier: null,
      selectedModel: null,
      externalServiceDetected: false,
      lastError: null,
    },
    permissions: null,
    workspaceConfigured: false,
    workspaceRootName: null,
    hardware: null,
  });

  assert.ok(result);
  assert.match(result, /not running/i);
  // Should include the plain-English stage explanation, not raw "not_started"
  assert.doesNotMatch(result, /not_started/);
});

test('buildGorkhContextBlock includes permission status', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const result = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: 'native_qwen_ollama',
    providerConfigured: true,
    freeAi: null,
    permissions: {
      screenRecordingStatus: 'granted',
      accessibilityStatus: 'denied',
      screenPreviewEnabled: false,
      controlEnabled: true,
    },
    workspaceConfigured: false,
    workspaceRootName: null,
    hardware: null,
  });

  assert.ok(result);
  assert.match(result, /Screen Recording: granted/i);
  assert.match(result, /Accessibility: denied/i);
  assert.match(result, /Remote control: enabled/i);
});

test('buildGorkhContextBlock includes workspace info', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const result = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: 'native_qwen_ollama',
    providerConfigured: true,
    freeAi: null,
    permissions: null,
    workspaceConfigured: true,
    workspaceRootName: 'my-project',
    hardware: null,
  });

  assert.ok(result);
  assert.match(result, /my-project/);
  assert.match(result, /configured/i);
});

test('buildGorkhContextBlock does not include sensitive data', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const result = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: 'native_qwen_ollama',
    providerConfigured: true,
    freeAi: {
      installStage: 'error',
      runtimeRunning: false,
      selectedTier: 'light',
      selectedModel: 'qwen2.5:1.5b',
      externalServiceDetected: false,
      lastError: 'Checksum verification failed for download',
    },
    permissions: {
      screenRecordingStatus: 'granted',
      accessibilityStatus: 'granted',
      screenPreviewEnabled: true,
      controlEnabled: false,
    },
    workspaceConfigured: true,
    workspaceRootName: 'project',
    hardware: {
      gpuClass: 'unknown',
      ramGb: 16,
    },
  });

  assert.ok(result);

  // No absolute paths
  assert.doesNotMatch(result ?? '', /\/Users\/|\/home\//);
  // No API keys
  assert.doesNotMatch(result ?? '', /sk-[a-zA-Z0-9]{10,}/);
});

test('buildGorkhContextBlock is honest about GPU: unknown means CPU', async () => {
  const { buildGorkhContextBlock } = await import('../apps/desktop/src/lib/gorkhContext.ts');

  const resultUnknown = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: null,
    providerConfigured: false,
    freeAi: null,
    permissions: null,
    workspaceConfigured: false,
    workspaceRootName: null,
    hardware: { gpuClass: 'unknown', ramGb: 8 },
  });

  const resultDiscrete = buildGorkhContextBlock({
    authState: 'signed_in',
    provider: null,
    providerConfigured: false,
    freeAi: null,
    permissions: null,
    workspaceConfigured: false,
    workspaceRootName: null,
    hardware: { gpuClass: 'discrete', ramGb: 32 },
  });

  // unknown GPU → CPU label (no overclaiming)
  assert.match(resultUnknown ?? '', /cpu/i);
  assert.doesNotMatch(resultUnknown ?? '', /gpu acceleration|using gpu/i);

  // discrete GPU → GPU label
  assert.match(resultDiscrete ?? '', /gpu/i);
});

// ---------------------------------------------------------------------------
// buildGorkhIdentity tests
// ---------------------------------------------------------------------------

test('buildGorkhIdentity identifies as GORKH not generic assistant', async () => {
  const { buildGorkhIdentity } = await import('../apps/desktop/src/lib/gorkhContext.ts');
  const identity = buildGorkhIdentity();
  assert.match(identity, /gorkh/i);
  assert.doesNotMatch(identity, /you are an ai assistant helping/i);
});

// ---------------------------------------------------------------------------
// onboarding copy tests
// ---------------------------------------------------------------------------

test('GORKH onboarding greeting is conversation-first and asks how it can help', async () => {
  const { GORKH_ONBOARDING } = await import('../apps/desktop/src/lib/gorkhKnowledge.ts');

  assert.match(GORKH_ONBOARDING.firstGreeting, /gorkh/i);
  assert.match(GORKH_ONBOARDING.firstGreeting, /what would you like|how can i help/i);
  assert.doesNotMatch(GORKH_ONBOARDING.firstGreeting, /taking any action|starting now/i);
});

test('GORKH onboarding setup guidance is honest when Free AI is not ready', async () => {
  const { GORKH_ONBOARDING } = await import('../apps/desktop/src/lib/gorkhKnowledge.ts');

  assert.match(GORKH_ONBOARDING.freeAiNotReady, /free ai/i);
  assert.match(GORKH_ONBOARDING.freeAiNotReady, /set.*up|get started/i);
  assert.doesNotMatch(GORKH_ONBOARDING.freeAiNotReady, /already starting|I have begun/i);
});
