import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop main assistant flow exposes only real supported paid providers', async () => {
  let imported: typeof import('../apps/desktop/src/lib/llmConfig.ts');
  try {
    imported = await import('../apps/desktop/src/lib/llmConfig.ts');
  } catch {
    assert.fail('shared llmConfig helper should exist');
    return;
  }

  const paidProviders = imported
    .getSupportedLlmProviders()
    .filter((provider) => provider.paid)
    .map((provider) => provider.provider);

  assert.deepEqual(paidProviders, ['openai', 'claude', 'deepseek', 'minimax', 'kimi']);

  assert.equal(imported.providerRequiresApiKey('openai'), true);
  assert.equal(imported.providerRequiresApiKey('claude'), true);
  assert.equal(imported.providerRequiresApiKey('deepseek'), true);
  assert.equal(imported.providerRequiresApiKey('minimax'), true);
  assert.equal(imported.providerRequiresApiKey('kimi'), true);

  assert.equal(imported.getLlmRuntimeProvider('claude'), 'claude');
  assert.equal(imported.getLlmRuntimeProvider('deepseek'), 'openai_compat');
  assert.equal(imported.getLlmRuntimeProvider('minimax'), 'openai_compat');
  assert.equal(imported.getLlmRuntimeProvider('kimi'), 'openai_compat');

  assert.equal(imported.getLlmDefaults('openai').baseUrl, 'https://api.openai.com/v1');
  assert.equal(imported.getLlmDefaults('deepseek').baseUrl, 'https://api.deepseek.com');
});

test('desktop settings primary flow presents paid providers with real provider labels', () => {
  const source = readFileSync('apps/desktop/src/components/SettingsPanel.tsx', 'utf8');

  assert.match(source, /Claude/i);
  assert.match(source, /DeepSeek/i);
  assert.match(source, /MiniMax/i);
  assert.match(source, /Kimi/i);
  assert.match(source, /Paid provider|charges may apply|billed by your provider/i);
});
