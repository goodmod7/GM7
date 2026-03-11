import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop defaults to native local Qwen via Ollama for the main assistant flow', async () => {
  let imported: typeof import('../apps/desktop/src/lib/llmConfig.ts');
  try {
    imported = await import('../apps/desktop/src/lib/llmConfig.ts');
  } catch {
    assert.fail('llmConfig helper should exist for shared desktop provider defaults');
    return;
  }

  assert.equal(imported.DEFAULT_LLM_PROVIDER, 'native_qwen_ollama');
  assert.deepEqual(imported.getLlmDefaults('native_qwen_ollama'), {
    provider: 'native_qwen_ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:1.5b',
  });
  assert.equal(imported.providerRequiresApiKey('native_qwen_ollama'), false);
  assert.equal(imported.providerRequiresApiKey('openai'), true);
});

test('desktop source makes local Ollama the obvious default instead of OpenAI', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const settingsSource = readFileSync('apps/desktop/src/components/SettingsPanel.tsx', 'utf8');
  const llmConfigSource = readFileSync('apps/desktop/src/lib/llmConfig.ts', 'utf8');

  assert.match(appSource, /DEFAULT_LLM_PROVIDER/, 'desktop app should source its default provider from the shared desktop llm config');
  assert.match(
    settingsSource,
    /Local Qwen|Qwen via Ollama|Ollama/i,
    'desktop settings should present local Qwen/Ollama as a real provider option'
  );
  assert.match(
    llmConfigSource,
    /Start Free AI|managed local runtime|app-managed/i,
    'native local provider copy should describe the managed desktop flow instead of only manual Ollama setup'
  );
});
