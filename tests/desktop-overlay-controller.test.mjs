import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop overlay mode uses a compact bottom-right controller for live controls and short chat', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const controllerSource = readFileSync('apps/desktop/src/components/OverlayController.tsx', 'utf8');

  assert.match(appSource, /OverlayController/, 'app should render a dedicated overlay controller');
  assert.match(appSource, /overlayPreviewMessages|messages\.slice\(-/, 'app should feed a short message preview into the controller');
  assert.match(
    appSource,
    /isOverlayActive && \(\s*<>[\s\S]*ActiveOverlayShell[\s\S]*OverlayController|isOverlayActive && \([\s\S]*OverlayController/,
    'overlay controller should render only in active overlay mode alongside the shell'
  );

  assert.match(
    controllerSource,
    /right:\s*'1\.5rem'|right:\s*"1\.5rem"|bottom:\s*'1\.5rem'|bottom:\s*"1\.5rem"/,
    'controller should anchor itself in the bottom-right corner'
  );
  assert.match(controllerSource, /position:\s*'fixed'|position:\s*"fixed"/, 'controller should float above the overlay');
  assert.match(controllerSource, /\bGORKH\b/, 'controller should carry the GORKH brand');
  assert.match(controllerSource, /Stop/, 'controller should expose a stop button');
  assert.match(controllerSource, /Pause|Resume/, 'controller should expose pause or resume');
  assert.match(controllerSource, /Details|Expand/, 'controller should expose a details affordance');
  assert.match(
    controllerSource,
    /messages\.length|messagePreview|short chat|conversation/i,
    'controller should include a short assistant chat area'
  );
  assert.match(controllerSource, /statusLabel/, 'controller should show the current assistant status label');
  assert.doesNotMatch(
    controllerSource,
    /rgba\(5,\s*7,\s*10,\s*0\.9\)|rgba\(8,\s*10,\s*14,\s*0\.94\)/,
    'overlay controller should move away from the old near-opaque dark card treatment'
  );
  assert.match(
    controllerSource,
    /rgba\(255,\s*255,\s*255,\s*0\.[0-3]\)|transparent/i,
    'overlay controller should use a lighter translucent glass treatment'
  );
});

test('desktop overlay/chat flow surfaces completed results and explicit done/error labels', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');

  assert.match(
    appSource,
    /currentProposal\?\.kind !== 'done'|currentProposal\?\.kind === 'done'|currentProposal\.kind === 'done'/,
    'desktop app should react to done proposals from the retail assistant engine'
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
