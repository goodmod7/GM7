import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rustBridgePath = 'apps/desktop/src-tauri/src/lib.rs';
const llmModulePath = 'apps/desktop/src-tauri/src/llm/mod.rs';
const aiAssistPath = 'apps/desktop/src/lib/aiAssist.ts';
const appPath = 'apps/desktop/src/App.tsx';

test('desktop Rust LLM bridge supports native_qwen_ollama in the real main assistant flow', () => {
  const llmSource = readFileSync(llmModulePath, 'utf8');

  assert.match(llmSource, /pub mod native_ollama;/, 'main desktop LLM module should include a native Ollama provider');
  assert.match(
    llmSource,
    /"native_qwen_ollama"\s*=>\s*Ok\(Box::new\(native_ollama::NativeOllamaProvider\)\)/,
    'main desktop LLM provider factory should support native_qwen_ollama'
  );
});

test('local providers in llm_propose_next_action do not require an API key', () => {
  const rustSource = readFileSync(rustBridgePath, 'utf8');

  assert.match(
    rustSource,
    /match params\.provider\.as_str\(\)/,
    'desktop LLM bridge should branch key handling by provider type'
  );
  assert.match(
    rustSource,
    /"native_qwen_ollama"/,
    'native_qwen_ollama should be treated as a keyless local provider in the bridge'
  );
  assert.match(
    rustSource,
    /"openai_compat"/,
    'openai_compat should remain supported as a local optional provider'
  );
});

test('desktop assistant flow uses managed local runtime status for native local provider readiness and model binding', () => {
  const aiAssistSource = readFileSync(aiAssistPath, 'utf8');
  const appSource = readFileSync(appPath, 'utf8');

  assert.match(
    aiAssistSource,
    /local_ai_status/,
    'native local provider readiness should consult the managed local runtime status'
  );
  assert.match(
    appSource,
    /resolveManagedLocalLlmBinding/,
    'main desktop assistant flow should bind native local provider model/base URL from managed local runtime state'
  );
});
