import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop updater helper exposes stable background download state helpers', async () => {
  let imported: typeof import('../apps/desktop/src/lib/desktopUpdater.ts');
  try {
    imported = await import('../apps/desktop/src/lib/desktopUpdater.ts');
  } catch {
    assert.fail('desktop updater helper should exist');
    return;
  }

  assert.equal(typeof imported.createIdleDesktopUpdaterState, 'function');
  assert.equal(typeof imported.getDesktopUpdaterStatusMessage, 'function');
  assert.equal(typeof imported.shouldAutoCheckDesktopUpdates, 'function');

  assert.equal(
    imported.shouldAutoCheckDesktopUpdates({
      updaterEnabled: true,
      backgroundCheckStarted: false,
    }),
    true
  );

  assert.equal(
    imported.shouldAutoCheckDesktopUpdates({
      updaterEnabled: false,
      backgroundCheckStarted: false,
    }),
    false
  );

  assert.match(
    imported.getDesktopUpdaterStatusMessage({
      status: 'downloaded',
      currentVersion: '0.0.19',
      nextVersion: '0.0.20',
      progressPercent: 100,
      bytesDownloaded: null,
      bytesTotal: null,
      notes: 'Bug fixes',
      error: null,
      restartReady: true,
      checkedInBackground: true,
    }),
    /restart to update/i
  );
});

test('desktop updater wiring enables the Rust process plugin for restart after install', () => {
  const cargoToml = readFileSync('apps/desktop/src-tauri/Cargo.toml', 'utf8');
  const tauriLib = readFileSync('apps/desktop/src-tauri/src/lib.rs', 'utf8');
  const capability = JSON.parse(readFileSync('apps/desktop/src-tauri/capabilities/default.json', 'utf8'));

  assert.match(cargoToml, /tauri-plugin-process\s*=\s*"2"/, 'desktop runtime should depend on the process plugin');
  assert.match(
    tauriLib,
    /plugin\(tauri_plugin_process::init\(\)\)/,
    'desktop runtime should enable the Tauri process plugin before using relaunch in the frontend'
  );
  assert.deepEqual(
    capability.permissions,
    [
      'core:app:allow-version',
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'desktop-ipc',
      'updater:allow-check',
      'updater:allow-download',
      'updater:allow-install',
      'process:allow-restart',
    ],
    'desktop capability must allow the updater check/download/install flow and process restart used by the in-app updater'
  );
});
