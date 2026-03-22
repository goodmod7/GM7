import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('advanced runtime no longer hard-fails before execution and exposes a real retail approval loop', () => {
  const runtimeSource = readFileSync('apps/desktop/src-tauri/src/agent/mod.rs', 'utf8');
  const bridgeSource = readFileSync('apps/desktop/src-tauri/src/lib.rs', 'utf8');
  const clientSource = readFileSync('apps/desktop/src/lib/advancedAgent.ts', 'utf8');
  const engineSource = readFileSync('apps/desktop/src/lib/assistantEngine.ts', 'utf8');

  assert.doesNotMatch(
    runtimeSource,
    /Advanced Agent runtime is not yet available in packaged beta builds/,
    'advanced runtime should not still intentionally fail after planning'
  );
  assert.match(
    runtimeSource,
    /ProposalReady|proposal_ready/,
    'advanced runtime should surface real proposals into the retail approval pipeline'
  );
  assert.match(
    bridgeSource,
    /approve_agent_proposal/,
    'desktop bridge should expose approval for advanced-runtime proposals'
  );
  assert.match(
    bridgeSource,
    /deny_agent_proposal/,
    'desktop bridge should expose denial for advanced-runtime proposals'
  );
  assert.match(
    bridgeSource,
    /submit_agent_user_response/,
    'desktop bridge should expose user-response handling for advanced-runtime questions'
  );
  assert.match(clientSource, /invoke\('approve_agent_proposal'/);
  assert.match(clientSource, /invoke\('deny_agent_proposal'/);
  assert.match(clientSource, /invoke\('submit_agent_user_response'/);
  assert.doesNotMatch(
    clientSource,
    /Mock implementation/,
    'advanced-agent client should be runtime-backed instead of mock data'
  );
  assert.doesNotMatch(
    engineSource,
    /not yet wired into the retail approval pipeline/,
    'assistant engine should not report an unimplemented approval loop once the advanced runtime is live'
  );
});

test('advanced agent provider list comes from the native runtime', () => {
  const clientSource = readFileSync('apps/desktop/src/lib/advancedAgent.ts', 'utf8');

  assert.match(
    clientSource,
    /invoke\('list_agent_providers'/,
    'advanced-agent provider list should come from the Tauri runtime rather than a hardcoded array'
  );
});

test('advanced runtime wires open_app through parser, executor mapping, and provider prompts', () => {
  const runtimeSource = readFileSync('apps/desktop/src-tauri/src/agent/mod.rs', 'utf8');
  const executorSource = readFileSync('apps/desktop/src-tauri/src/agent/executor.rs', 'utf8');
  const llmSource = readFileSync('apps/desktop/src-tauri/src/llm/mod.rs', 'utf8');
  const nativeProviderSource = readFileSync('apps/desktop/src-tauri/src/agent/providers/native_ollama.rs', 'utf8');
  const localCompatProviderSource = readFileSync('apps/desktop/src-tauri/src/agent/providers/local_compat.rs', 'utf8');
  const openAiProviderSource = readFileSync('apps/desktop/src-tauri/src/agent/providers/openai.rs', 'utf8');
  const claudeProviderSource = readFileSync('apps/desktop/src-tauri/src/agent/providers/claude.rs', 'utf8');

  assert.match(
    executorSource,
    /OpenApp\s*\{\s*app_name:\s*String\s*\}/,
    'advanced executor should continue to expose a concrete OpenApp action'
  );
  assert.match(
    llmSource,
    /enum InputAction[\s\S]*OpenApp\s*\{[\s\S]*app_name:\s*String,?\s*\}/,
    'retail Rust LLM action types should include OpenApp so proposals can cross the desktop bridge'
  );
  assert.match(
    runtimeSource,
    /"open_app"/,
    'advanced runtime parser should recognize open_app from provider JSON'
  );
  assert.match(
    runtimeSource,
    /RetailInputAction::OpenApp/,
    'advanced runtime should create retail open_app proposals instead of rejecting them'
  );
  assert.match(
    runtimeSource,
    /executor::Action::OpenApp/,
    'advanced runtime should map retail open_app proposals into executor::Action::OpenApp'
  );
  assert.match(
    nativeProviderSource,
    /open_app/,
    'native Ollama provider prompt should tell the model that open_app is valid'
  );
  assert.match(
    localCompatProviderSource,
    /open_app/,
    'local OpenAI-compatible provider prompt should tell the model that open_app is valid'
  );
  assert.match(
    openAiProviderSource,
    /open_app/,
    'OpenAI provider prompt should tell the model that open_app is valid'
  );
  assert.match(
    claudeProviderSource,
    /open_app/,
    'Claude provider prompt should tell the model that open_app is valid'
  );
});
