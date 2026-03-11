import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const rustModulePath = 'apps/desktop/src-tauri/src/local_ai.rs';
const rustBridgePath = 'apps/desktop/src-tauri/src/lib.rs';
const rustManifestPath = 'apps/desktop/src-tauri/src/local_ai_manifest.rs';

test('desktop local AI manager module exists with runtime, install, and hardware payloads', () => {
  assert.equal(existsSync(rustModulePath), true, 'local AI manager Rust module should exist');
  const source = readFileSync(rustModulePath, 'utf8');

  assert.match(source, /struct LocalAiRuntimeStatus/i, 'local AI module should define a runtime status payload');
  assert.match(source, /struct LocalAiInstallProgress/i, 'local AI module should define install progress payload');
  assert.match(source, /struct LocalAiHardwareProfile/i, 'local AI module should define a hardware profile payload');
  assert.match(source, /enum LocalAiTier/i, 'local AI module should define hardware-aware model tiers');
});

test('desktop local AI bridge exports the managed runtime command surface', () => {
  const source = readFileSync(rustBridgePath, 'utf8');

  for (const command of [
    'local_ai_status',
    'local_ai_install_start',
    'local_ai_enable_vision_boost',
    'local_ai_install_progress',
    'local_ai_start',
    'local_ai_stop',
    'local_ai_hardware_profile',
    'local_ai_recommended_tier',
  ]) {
    assert.match(
      source,
      new RegExp(`#\\s*\\[\\s*tauri::command(?:\\([^)]*\\))?\\s*]\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+${command}\\b`),
      `${command} should be exported as a tauri command`
    );
  }
});

test('desktop local AI manager models managed and adopted runtime sources as a typed retail setup contract', () => {
  const source = readFileSync(rustModulePath, 'utf8');

  assert.match(
    source,
    /enum LocalAiRuntimeSource/i,
    'retail local AI setup should model runtime ownership with a typed enum'
  );
  assert.match(
    source,
    /Managed/i,
    'runtime source contract should include an app-managed path'
  );
  assert.match(
    source,
    /ExistingInstall|AdoptExisting|AdoptedExisting/i,
    'runtime source contract should include an adopted existing-install path'
  );
  assert.match(
    source,
    /runtime_source:\s*Option<LocalAiRuntimeSource>/i,
    'runtime source should not remain a free-form string in the status payload'
  );
});

test('desktop local AI manager defines a cross-platform managed runtime manifest contract', () => {
  assert.equal(existsSync(rustManifestPath), true, 'managed runtime manifest module should exist');
  const manifestSource = readFileSync(rustManifestPath, 'utf8');
  const localAiSource = readFileSync(rustModulePath, 'utf8');

  assert.match(
    manifestSource,
    /enum LocalAiRuntimePlatformTarget/i,
    'manifest module should define explicit target platforms'
  );
  assert.match(
    manifestSource,
    /MacosArm64|MacosX64|WindowsX64/i,
    'manifest module should cover macOS and Windows runtime targets'
  );
  assert.match(
    manifestSource,
    /struct LocalAiRuntimeAssetManifest/i,
    'manifest module should define the runtime asset manifest payload'
  );
  assert.match(manifestSource, /runtime_version:\s*(?:String|&'static str)/i, 'manifest should include runtime version');
  assert.match(manifestSource, /target_platform:\s*LocalAiRuntimePlatformTarget/i, 'manifest should include target platform');
  assert.match(manifestSource, /download_url:\s*(?:String|&'static str)/i, 'manifest should include a download URL');
  assert.match(manifestSource, /checksum(?:_sha256)?:\s*(?:String|&'static str)/i, 'manifest should include a checksum field');
  assert.match(
    manifestSource,
    /binary_relative_path:\s*(?:String|&'static str)/i,
    'manifest should include the runtime binary relative path'
  );
  assert.match(
    manifestSource,
    /fn (?:resolve_current_runtime_asset|current_runtime_asset|runtime_asset_for_target)\b/i,
    'manifest module should expose a current-platform asset resolver'
  );
  assert.match(
    localAiSource,
    /local_ai_manifest/i,
    'local AI manager should use the manifest module for runtime asset resolution'
  );
});

test('desktop managed runtime manifest points at real official Ollama assets for macOS and Windows instead of placeholder dev URLs', () => {
  const manifestSource = readFileSync(rustManifestPath, 'utf8');

  assert.match(
    manifestSource,
    /v0\.\d+\.\d+/,
    'managed runtime manifest should pin a real upstream Ollama release tag'
  );
  assert.match(
    manifestSource,
    /https:\/\/github\.com\/ollama\/ollama\/releases\/download/i,
    'managed runtime manifest should download from official Ollama release assets'
  );
  assert.match(
    manifestSource,
    /ollama-darwin\.tgz/i,
    'managed runtime manifest should provide the standalone macOS runtime archive'
  );
  assert.match(
    manifestSource,
    /ollama-windows-amd64\.zip/i,
    'managed runtime manifest should provide the standalone Windows runtime archive'
  );
  assert.doesNotMatch(
    manifestSource,
    /0\.0\.0-dev|downloads\.goodmod7\.com|dev-[a-z0-9-]+-sha256/i,
    'shipping manifest should not keep placeholder runtime versions, URLs, or checksum values'
  );
});
