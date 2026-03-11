import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop overlay mode uses dedicated window commands and app lifecycle wiring', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const overlayHelperSource = readFileSync('apps/desktop/src/lib/overlayMode.ts', 'utf8');
  const rustSource = readFileSync('apps/desktop/src-tauri/src/lib.rs', 'utf8');

  assert.match(overlayHelperSource, /main_window_enter_overlay_mode/, 'desktop should expose an enter-overlay IPC helper');
  assert.match(overlayHelperSource, /main_window_exit_overlay_mode/, 'desktop should expose an exit-overlay IPC helper');
  assert.match(overlayHelperSource, /main_window_overlay_status/, 'desktop should expose overlay-status IPC helper');

  assert.match(appSource, /enterOverlayMode/, 'app should be able to enter overlay mode');
  assert.match(appSource, /exitOverlayMode/, 'app should be able to exit overlay mode');
  assert.match(appSource, /aiState\?\.isRunning/, 'overlay lifecycle should follow active assistant execution');
  assert.match(appSource, /handleStopAll[\s\S]*exitOverlayMode/, 'stop flow should force an overlay exit path');

  assert.match(rustSource, /fn main_window_enter_overlay_mode/, 'Rust should export an enter-overlay command');
  assert.match(rustSource, /fn main_window_exit_overlay_mode/, 'Rust should export an exit-overlay command');
  assert.match(rustSource, /fn main_window_overlay_status/, 'Rust should export an overlay-status command');
  assert.match(rustSource, /previous: Option<OverlayWindowSnapshot>/, 'overlay runtime should snapshot prior window state');
  assert.match(rustSource, /overlay mode/i, 'Rust window layer should track overlay mode explicitly');
  assert.match(
    rustSource,
    /CloseRequested[\s\S]*main_window_exit_overlay_mode_impl|CloseRequested[\s\S]*exit_overlay_mode/i,
    'closing the window during overlay mode should exit overlay state safely instead of leaving it stuck'
  );
});
