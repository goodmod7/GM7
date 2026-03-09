import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = '.github/workflows/desktop-release.yml';

test('desktop release workflow invokes Tauri through the desktop package script', () => {
  const source = readFileSync(workflowPath, 'utf8');

  assert.match(
    source,
    /pnpm --filter @ai-operator\/desktop tauri:build --bundles msi/,
    'Windows release job must build via the desktop package script'
  );

  assert.match(
    source,
    /pnpm --filter @ai-operator\/desktop tauri:build --config "\$MACOS_TAURI_CONFIG" --bundles dmg/,
    'Stable macOS release job must build via the desktop package script'
  );

  assert.match(
    source,
    /pnpm --filter @ai-operator\/desktop tauri:build --bundles dmg/,
    'Beta macOS release job must build via the desktop package script'
  );

  assert.doesNotMatch(
    source,
    /pnpm --filter @ai-operator\/desktop exec tauri build/,
    'Release workflow must not rely on recursive pnpm exec for the Tauri CLI'
  );
});
