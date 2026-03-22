import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop overlay controller should be a transparent floating control strip, not a glass card', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const controllerSource = readFileSync('apps/desktop/src/components/OverlayController.tsx', 'utf8');

  assert.match(appSource, /OverlayController/, 'app should still render a dedicated overlay controller');
  assert.match(appSource, /overlayPreviewMessages|messages\.slice\(-/, 'app should still feed a short message preview into the controller');
  assert.match(
    appSource,
    /isOverlayActive && \(\s*<>[\s\S]*ActiveOverlayShell[\s\S]*OverlayController|isOverlayActive && \([\s\S]*OverlayController/,
    'overlay controller should still render only in active overlay mode alongside the shell'
  );

  assert.match(controllerSource, /position:\s*'fixed'|position:\s*"fixed"/, 'controller should float above the desktop');
  assert.match(controllerSource, /\bGORKH\b/, 'controller should carry the GORKH brand');
  assert.match(controllerSource, /Stop/, 'controller should expose a stop button');
  assert.match(controllerSource, /Pause|Resume/, 'controller should expose pause or resume');
  assert.match(controllerSource, /Details|Expand|Hide details|Show details/, 'controller should expose a details affordance');
  assert.match(
    controllerSource,
    /messages\.length|messagePreview|short chat|conversation/i,
    'controller should include a short assistant chat area'
  );
  assert.match(controllerSource, /statusLabel/, 'controller should show the current assistant status label');
  assert.doesNotMatch(
    controllerSource,
    /backdropFilter:\s*'blur\(|backdropFilter:\s*"blur\(|rgba\(255,\s*255,\s*255,\s*0\.18\)|rgba\(15,\s*23,\s*42,\s*0\.16\)/,
    'controller should not rely on a frosted fullscreen-card treatment'
  );
  assert.doesNotMatch(
    controllerSource,
    /width:\s*'min\(390px, calc\(100vw - 2rem\)\)'/,
    'controller should be more compact than the current large card shell'
  );
});

test('desktop overlay/chat flow should keep execution-state labels separate from overlay chrome', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');

  assert.match(
    appSource,
    /currentProposal\?\.kind !== 'done'|currentProposal\?\.kind === 'done'|currentProposal\.kind === 'done'/,
    'desktop app should still react to done proposals from the assistant engine'
  );
  assert.match(
    appSource,
    /createChatItem\('agent',\s*currentProposal\.summary\)|createChatItem\("agent",\s*currentProposal\.summary\)/,
    'desktop app should append the assistant completion summary into chat'
  );
  assert.match(
    appSource,
    /aiState\?\.status === 'done'[\s\S]*aiState\?\.status === 'error'/,
    'overlay status label should explicitly handle done and error states instead of falling through to thinking'
  );
});
