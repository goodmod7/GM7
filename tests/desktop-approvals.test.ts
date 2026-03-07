import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createApprovalController,
  summarizeInputAction,
  summarizeToolCall,
} from '../apps/desktop/src/lib/approvals.ts';

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

test('approval controller expires due pending items', () => {
  const controller = createApprovalController({
    autoStart: false,
    storage: createStorage(),
  });

  const approvalId = controller.createApproval({
    kind: 'control_action',
    createdAt: 1_000,
    expiresAt: 1_500,
    summary: 'Click left at 50%, 50%',
    risk: 'low',
    source: 'web',
  });

  controller.expireDueApprovals(1_600);

  const [expired] = controller.getItems();
  assert.equal(expired.id, approvalId);
  assert.equal(expired.state, 'expired');
});

test('approval summaries redact sensitive content', () => {
  assert.equal(
    summarizeInputAction({
      kind: 'type',
      text: 'super-secret-value',
    }),
    'Type (18 chars)'
  );

  assert.equal(
    summarizeToolCall({
      tool: 'terminal.exec',
      cmd: 'pnpm',
      args: ['deploy', '--token', 'secret-token'],
      cwd: '.',
    }),
    'terminal.exec cmd=pnpm'
  );

  assert.equal(
    summarizeToolCall({
      tool: 'fs.read_text',
      path: '.env.local',
    }),
    'fs.read_text path=.env.local'
  );
});

test('stop-all cancels all pending approvals without rewriting terminal states', () => {
  const controller = createApprovalController({
    autoStart: false,
    storage: createStorage(),
  });

  const pendingControlId = controller.createApproval({
    kind: 'control_action',
    createdAt: 1_000,
    expiresAt: 61_000,
    summary: 'Click left at 10%, 20%',
    risk: 'low',
    source: 'web',
  });
  const pendingToolId = controller.createApproval({
    kind: 'tool_call',
    createdAt: 2_000,
    expiresAt: 62_000,
    summary: 'terminal.exec cmd=pnpm',
    risk: 'high',
    source: 'agent',
  });
  const deniedId = controller.createApproval({
    kind: 'ai_proposal',
    createdAt: 3_000,
    expiresAt: 63_000,
    summary: 'AI action proposal: Click left at 60%, 40%',
    risk: 'medium',
    source: 'agent',
  });

  controller.deny(deniedId);
  controller.cancelAllPending('Stop all requested');

  const itemsById = new Map(controller.getItems().map((item) => [item.id, item]));
  assert.equal(itemsById.get(pendingControlId)?.state, 'canceled');
  assert.equal(itemsById.get(pendingToolId)?.state, 'canceled');
  assert.equal(itemsById.get(deniedId)?.state, 'denied');
});
