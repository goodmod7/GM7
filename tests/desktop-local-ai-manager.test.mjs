import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const rustModulePath = 'apps/desktop/src-tauri/src/local_ai.rs';
const rustBridgePath = 'apps/desktop/src-tauri/src/lib.rs';

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
