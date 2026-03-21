import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop renders a fullscreen premium overlay shell while active work is running', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const overlayShellSource = readFileSync('apps/desktop/src/components/ActiveOverlayShell.tsx', 'utf8');

  assert.match(
    appSource,
    /const isOverlayActive = Boolean\(overlayModeStatus\?\.active && aiState\?\.isRunning\)/,
    'app should derive overlay rendering from real assistant activity and overlay window state'
  );
  assert.match(appSource, /ActiveOverlayShell/, 'app should render a dedicated overlay shell component');
  assert.match(
    appSource,
    /opacity:\s*isOverlayActive \? 0 : 1|display:\s*isOverlayActive \? 'none' : 'block'/,
    'retail panels should be visually hidden or demoted while overlay mode is active'
  );
  assert.match(
    appSource,
    /isOverlayActive && \(\s*<>[\s\S]*ActiveOverlayShell|isOverlayActive && \([\s\S]*ActiveOverlayShell/,
    'overlay shell should only render during active overlay mode'
  );

  assert.match(
    overlayShellSource,
    /position:\s*'fixed'|position:\s*"fixed"/,
    'overlay shell should pin itself over the whole window'
  );
  assert.match(
    overlayShellSource,
    /backdropFilter:\s*'blur\(|backdropFilter:\s*"blur\(/,
    'overlay shell should use a glass-like blur treatment'
  );
  assert.match(
    overlayShellSource,
    /linear-gradient|radial-gradient|rgba\(255,\s*255,\s*255/i,
    'overlay shell should keep a layered glass treatment instead of a flat overlay'
  );
  assert.doesNotMatch(
    overlayShellSource,
    /rgba\(0,\s*0,\s*0,\s*0\.(?:[5-9]|\d{2,})\)|rgba\(0,\s*0,\s*0,\s*1\)/i,
    'overlay shell should no longer rely on heavy black dimming once the user needs to watch the desktop underneath'
  );
  assert.match(overlayShellSource, /\bGORKH\b/, 'overlay shell should carry the GORKH brand');
  assert.match(overlayShellSource, /pointerEvents:\s*'none'|pointerEvents:\s*"none"/, 'overlay shell should behave as the atmospheric layer while the controller stays interactive');
});
