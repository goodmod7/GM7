import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop chrome should expose a broader draggable shell than the current wordmark handle', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const overlayHelperSource = readFileSync('apps/desktop/src/lib/overlayMode.ts', 'utf8');
  const rustSource = readFileSync('apps/desktop/src-tauri/src/lib.rs', 'utf8');

  assert.match(overlayHelperSource, /main_window_enter_overlay_mode/, 'desktop should still expose an enter-overlay IPC helper');
  assert.match(overlayHelperSource, /main_window_exit_overlay_mode/, 'desktop should still expose an exit-overlay IPC helper');
  assert.match(overlayHelperSource, /main_window_overlay_status/, 'desktop should still expose overlay-status IPC helper');

  assert.match(appSource, /enterOverlayMode/, 'app should still be able to enter overlay mode');
  assert.match(appSource, /exitOverlayMode/, 'app should still be able to exit overlay mode');
  assert.match(appSource, /aiState\?\.isRunning/, 'overlay lifecycle should still follow active assistant execution');
  assert.match(appSource, /handleStopAll[\s\S]*exitOverlayMode/, 'stop flow should still force an overlay exit path');

  assert.match(rustSource, /fn main_window_enter_overlay_mode/, 'Rust should still export an enter-overlay command');
  assert.match(rustSource, /fn main_window_exit_overlay_mode/, 'Rust should still export an exit-overlay command');
  assert.match(rustSource, /fn main_window_overlay_status/, 'Rust should still export an overlay-status command');
  assert.match(rustSource, /previous: Option<OverlayWindowSnapshot>/, 'overlay runtime should still snapshot prior window state');
  assert.match(rustSource, /overlay mode/i, 'Rust window layer should still track overlay mode explicitly');
  assert.match(rustSource, /Hide GORKH/, 'hide-to-tray menu copy should clearly name the app');
  assert.match(rustSource, /Show GORKH/, 'show-from-tray menu copy should clearly name the app');
  assert.match(rustSource, /Quit GORKH/, 'quit menu copy should clearly tell macOS beta testers how to exit the app');
  assert.match(
    rustSource,
    /CloseRequested[\s\S]*main_window_exit_overlay_mode_impl|CloseRequested[\s\S]*exit_overlay_mode/i,
    'closing the window during overlay mode should still exit overlay state safely instead of leaving it stuck'
  );
  assert.match(appSource, /menu bar|tray icon/, 'desktop should still explain the platform-specific hide-to-tray or menu-bar behavior');
  assert.match(appSource, /Quit GORKH/, 'desktop should still point testers to the explicit quit action after hiding the window');

  assert.match(
    appSource,
    /data-tauri-drag-region[\s\S]{0,1500}BrandWordmark[\s\S]{0,1500}Open Settings/,
    'chrome should expose a larger draggable shell that spans beyond the wordmark-only handle'
  );
  assert.doesNotMatch(
    appSource,
    /data-tauri-drag-region style=\{\{ paddingLeft: platform === 'macos' \? '5\.5rem' : 0, minHeight: platform === 'macos' \? '2\.25rem' : undefined \}\}/,
    'chrome should not keep the tiny wordmark-only drag region'
  );
});
