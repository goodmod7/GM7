import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop action executor and Tauri bridge expose open_app end to end', () => {
  const actionExecutorSource = readFileSync('apps/desktop/src/lib/actionExecutor.ts', 'utf8');
  const tauriBridgeSource = readFileSync('apps/desktop/src-tauri/src/lib.rs', 'utf8');

  assert.match(
    actionExecutorSource,
    /case 'open_app':/,
    'desktop action executor should handle open_app instead of returning UNKNOWN_ACTION'
  );
  assert.match(
    actionExecutorSource,
    /invoke\('open_application'/,
    'desktop action executor should launch apps through a dedicated Tauri command'
  );
  assert.match(
    tauriBridgeSource,
    /async fn open_application|fn open_application/,
    'desktop Tauri bridge should expose an open_application command'
  );
  assert.match(
    tauriBridgeSource,
    /open_application,/,
    'desktop Tauri command handler should register open_application'
  );
});

test('main LLM prompts and retail runtime types mention open_app explicitly', () => {
  const llmTypesSource = readFileSync('apps/desktop/src-tauri/src/llm/mod.rs', 'utf8');
  const nativeOllamaSource = readFileSync('apps/desktop/src-tauri/src/llm/native_ollama.rs', 'utf8');
  const openAiSource = readFileSync('apps/desktop/src-tauri/src/llm/openai.rs', 'utf8');
  const openAiCompatSource = readFileSync('apps/desktop/src-tauri/src/llm/openai_compat.rs', 'utf8');
  const claudeSource = readFileSync('apps/desktop/src-tauri/src/llm/claude.rs', 'utf8');

  assert.match(
    llmTypesSource,
    /enum InputAction[\s\S]*OpenApp\s*\{[\s\S]*app_name:\s*String,?\s*\}/,
    'retail Rust LLM types should include OpenApp for main-model proposals'
  );
  assert.match(
    nativeOllamaSource,
    /open_app/,
    'native Ollama main prompt should tell the model that open_app is available'
  );
  assert.match(
    openAiSource,
    /open_app/,
    'OpenAI main prompt should tell the model that open_app is available'
  );
  assert.match(
    openAiCompatSource,
    /open_app/,
    'OpenAI-compatible main prompt should tell the model that open_app is available'
  );
  assert.match(
    claudeSource,
    /open_app/,
    'Claude main prompt should tell the model that open_app is available'
  );
});
