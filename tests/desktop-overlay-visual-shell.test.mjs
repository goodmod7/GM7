import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop overlay shell should be transparent and avoid a centered glass card', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const overlayShellSource = readFileSync('apps/desktop/src/components/ActiveOverlayShell.tsx', 'utf8');

  assert.match(appSource, /ActiveOverlayShell/, 'app should still render a dedicated overlay shell component');
  assert.doesNotMatch(
    appSource,
    /opacity:\s*isOverlayActive \? 0 : 1|filter:\s*isOverlayActive \? 'blur\(/,
    'overlay mode should not hide or blur the home shell behind the execution UI'
  );
  assert.doesNotMatch(
    appSource,
    /transform:\s*isOverlayActive \? 'scale\([^']+\)'/,
    'overlay mode should not scale the home shell down behind the execution UI'
  );
  assert.doesNotMatch(
    overlayShellSource,
    /backdropFilter:\s*'blur\(|backdropFilter:\s*"blur\(/,
    'overlay shell should not use a fullscreen blur/dimming layer'
  );
  assert.doesNotMatch(
    overlayShellSource,
    /position:\s*'fixed'[\s\S]*justifyContent:\s*'center'[\s\S]*borderRadius:\s*'28px'[\s\S]*BrandWordmark/,
    'overlay shell should not render a centered glass card around the brand'
  );
  assert.doesNotMatch(
    overlayShellSource,
    /radial-gradient|linear-gradient|rgba\(255,\s*255,\s*255/i,
    'overlay shell should not rely on decorative glass gradients for the execution surface'
  );
  assert.match(overlayShellSource, /\bGORKH\b/, 'overlay shell should still carry the GORKH brand');
});
