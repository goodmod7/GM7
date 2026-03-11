import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('active overlay mode demotes technical surfaces behind a dedicated details drawer', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const panelPath = 'apps/desktop/src/components/OverlayDetailsPanel.tsx';

  assert.equal(
    existsSync(panelPath),
    true,
    'overlay mode should use a dedicated details drawer instead of sending users straight to settings'
  );

  const panelSource = readFileSync(panelPath, 'utf8');

  assert.match(
    appSource,
    /const \[overlayDetailsOpen,\s*setOverlayDetailsOpen\]/,
    'app should track a dedicated overlay details state'
  );
  assert.match(appSource, /OverlayDetailsPanel/, 'app should render a dedicated overlay details panel');
  assert.match(
    appSource,
    /isOverlayActive && overlayDetailsOpen[\s\S]*OverlayDetailsPanel|overlayDetailsOpen && isOverlayActive[\s\S]*OverlayDetailsPanel/,
    'overlay details should only render during active overlay mode'
  );
  assert.doesNotMatch(
    appSource,
    /onOpenDetails=\{\(\) => setSettingsOpen\(true\)\}/,
    'overlay details should not route users directly into the full settings surface'
  );
  assert.match(
    panelSource,
    /Task details|Approval queue|Open full settings/i,
    'overlay details panel should carry secondary task and debug context'
  );
});
