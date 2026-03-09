import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const openAiLlmPath = 'apps/desktop/src-tauri/src/llm/openai.rs';
const openAiProviderPath = 'apps/desktop/src-tauri/src/agent/providers/openai.rs';
const localCompatProviderPath = 'apps/desktop/src-tauri/src/agent/providers/local_compat.rs';

test('desktop Rust providers use valid format strings for data URLs and auth headers', () => {
  const openAiLlm = readFileSync(openAiLlmPath, 'utf8');
  const openAiProvider = readFileSync(openAiProviderPath, 'utf8');
  const localCompatProvider = readFileSync(localCompatProviderPath, 'utf8');

  for (const [path, source] of [
    [openAiLlmPath, openAiLlm],
    [openAiProviderPath, openAiProvider],
    [localCompatProviderPath, localCompatProvider],
  ]) {
    assert.doesNotMatch(
      source,
      /format!\("data:image\/png;base64,\{"/,
      `${path} must not use a truncated data URL format string`
    );
  }

  assert.doesNotMatch(
    openAiProvider,
    /format!\("Bearer \{\}"\)/,
    `${openAiProviderPath} must pass the API key argument to the Authorization header format string`
  );
});
