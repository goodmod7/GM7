import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rustModulePath = 'apps/desktop/src-tauri/src/local_ai.rs';

test('desktop local AI runtime persists managed install metadata and uses Ollama with app-managed env', () => {
  const source = readFileSync(rustModulePath, 'utf8');

  assert.match(source, /struct LocalAiInstallMetadata/i, 'local AI manager should persist install metadata');
  assert.match(source, /managed-install\.json/i, 'local AI manager should keep install metadata in a stable file');
  assert.match(source, /OLLAMA_MODELS/i, 'managed local AI should direct model storage into the app-managed directory');
  assert.match(source, /OLLAMA_HOST/i, 'managed local AI should bind Ollama to the expected local service host');
  assert.match(source, /"serve"/i, 'managed local AI should be able to start the local runtime');
  assert.match(source, /"pull"/i, 'managed local AI should pull the selected model tier');
  assert.match(
    source,
    /find_system_ollama_binary|fs::copy/i,
    'managed local AI should adopt or install a runtime binary into the app-managed directory'
  );
});
