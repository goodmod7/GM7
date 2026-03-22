import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('overlay approvals should be compact floating cards instead of fullscreen blockers', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const approvalModalSource = readFileSync('apps/desktop/src/components/ApprovalModal.tsx', 'utf8');
  const actionApprovalSource = readFileSync('apps/desktop/src/components/ActionApprovalModal.tsx', 'utf8');
  const toolApprovalSource = readFileSync('apps/desktop/src/components/ToolApprovalModal.tsx', 'utf8');

  for (const modalName of ['ApprovalModal', 'ActionApprovalModal', 'ToolApprovalModal']) {
    assert.match(
      appSource,
      new RegExp(`${modalName}[\\s\\S]*overlayMode=\\{isOverlayActive\\}`),
      `${modalName} should still know when overlay mode is active`
    );
    assert.match(
      appSource,
      new RegExp(`${modalName}[\\s\\S]*onStopAll=\\{handleStopAll\\}`),
      `${modalName} should still preserve a stop-all path while approvals are pending`
    );
  }

  for (const source of [approvalModalSource, actionApprovalSource, toolApprovalSource]) {
    assert.match(source, /overlayMode\?: boolean/, 'approval surfaces should still support overlay-mode styling');
    assert.match(source, /onStopAll: \(\) => void|onStopAll\?: \(\) => void/, 'approval surfaces should still accept a stop-all callback');
    assert.match(source, /Stop all/i, 'approval surfaces should still expose a stop-all action');
    assert.doesNotMatch(
      source,
      /backgroundColor:\s*overlayMode \? 'rgba\(0,\s*0,\s*0,\s*0\.72\)'|backdropFilter:\s*overlayMode \? 'blur\(/,
      'approval surfaces should not use fullscreen black-backdrop blockers in overlay mode'
    );
    assert.doesNotMatch(
      source,
      /maxWidth:\s*'?(?:480|520)px'?\s*,[\s\S]*width:\s*'90%'/,
      'approval surfaces should not rely on oversized centered modal cards'
    );
  }
});
