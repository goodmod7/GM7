import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('overlay mode approvals use premium GORKH styling and preserve a stop-all path', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const approvalModalSource = readFileSync('apps/desktop/src/components/ApprovalModal.tsx', 'utf8');
  const actionApprovalSource = readFileSync('apps/desktop/src/components/ActionApprovalModal.tsx', 'utf8');
  const toolApprovalSource = readFileSync('apps/desktop/src/components/ToolApprovalModal.tsx', 'utf8');

  for (const modalName of ['ApprovalModal', 'ActionApprovalModal', 'ToolApprovalModal']) {
    assert.match(
      appSource,
      new RegExp(`${modalName}[\\s\\S]*overlayMode=\\{isOverlayActive\\}`),
      `${modalName} should know when the premium overlay mode is active`
    );
    assert.match(
      appSource,
      new RegExp(`${modalName}[\\s\\S]*onStopAll=\\{handleStopAll\\}`),
      `${modalName} should preserve a stop-all path while approvals are blocking the screen`
    );
  }

  for (const source of [approvalModalSource, actionApprovalSource, toolApprovalSource]) {
    assert.match(source, /overlayMode\?: boolean/, 'approval surfaces should support overlay-mode styling');
    assert.match(source, /onStopAll: \(\) => void|onStopAll\?: \(\) => void/, 'approval surfaces should accept a stop-all callback');
    assert.match(source, /\bGORKH\b|glass|backdropFilter|linear-gradient/i, 'approval surfaces should match the premium overlay visual language');
    assert.match(source, /Stop all/i, 'approval surfaces should expose a stop-all action');
  }
});
