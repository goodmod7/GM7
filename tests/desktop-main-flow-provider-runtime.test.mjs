import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const llmModulePath = 'apps/desktop/src-tauri/src/llm/mod.rs';
const bridgePath = 'apps/desktop/src-tauri/src/lib.rs';

test('desktop main Rust llm bridge supports paid providers used by the primary assistant flow', () => {
  const llmSource = readFileSync(llmModulePath, 'utf8');

  assert.match(llmSource, /pub mod claude;/, 'main llm module should expose a Claude adapter');
  assert.match(llmSource, /"claude"\s*=>\s*Ok\(Box::new\(claude::ClaudeProvider::new\(\)\)\)/, 'main llm module should map claude to its real adapter');
  assert.match(llmSource, /"deepseek"/, 'main llm module should support deepseek in create_provider');
  assert.match(llmSource, /"minimax"/, 'main llm module should support minimax in create_provider');
  assert.match(llmSource, /"kimi"/, 'main llm module should support kimi in create_provider');
});

test('desktop bridge treats paid cloud providers as key-required providers', () => {
  const bridgeSource = readFileSync(bridgePath, 'utf8');

  assert.match(bridgeSource, /"openai"/, 'openai should remain key-backed');
  assert.match(bridgeSource, /"claude"/, 'claude should be handled in the key-backed branch');
  assert.match(bridgeSource, /"deepseek"/, 'deepseek should be handled in the key-backed branch');
  assert.match(bridgeSource, /"minimax"/, 'minimax should be handled in the key-backed branch');
  assert.match(bridgeSource, /"kimi"/, 'kimi should be handled in the key-backed branch');
});
