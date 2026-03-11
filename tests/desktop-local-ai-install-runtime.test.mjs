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

test('desktop local AI runtime provisions a managed runtime from the manifest before startup and preserves adopt-existing fallback', () => {
  const source = readFileSync(rustModulePath, 'utf8');

  assert.match(
    source,
    /download_runtime_archive|download_managed_runtime|provision_managed_runtime/i,
    'managed local AI should define an explicit runtime download/provisioning path'
  );
  assert.match(
    source,
    /reqwest::blocking|blocking::Client/i,
    'runtime provisioning should perform a real blocking download inside the install worker'
  );
  assert.match(
    source,
    /sha2::|Sha256/i,
    'runtime provisioning should verify downloaded runtime checksums before install'
  );
  assert.match(
    source,
    /zip::ZipArchive|tar::Archive/i,
    'runtime provisioning should extract platform runtime archives instead of only copying a bare binary'
  );
  assert.match(
    source,
    /LocalAiInstallStage::Installed/i,
    'install flow should record an installed checkpoint after provisioning the runtime and before startup'
  );
  assert.match(
    source,
    /find_system_ollama_binary/i,
    'adopting an existing local install should remain available as a fallback path'
  );
});

test('desktop local AI runtime accepts official Ollama .tgz archives for macOS managed installs', () => {
  const source = readFileSync(rustModulePath, 'utf8');

  assert.match(
    source,
    /\.tgz/i,
    'runtime provisioning should recognize the official macOS Ollama .tgz asset extension'
  );
  assert.match(
    source,
    /managed-runtime\.tgz|ends_with\(\"\\.tgz\"\)/i,
    'archive naming and extraction should preserve the .tgz managed runtime path'
  );
});
