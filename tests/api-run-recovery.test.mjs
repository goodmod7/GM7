import assert from 'node:assert/strict';
import test from 'node:test';

test('run recovery marks in-progress runs as failed with server_restart reason', async () => {
  const { recoverInProgressRunsOnStartup } = await import('../apps/api/dist/lib/run-recovery.js');

  const run = {
    runId: 'run-1',
    deviceId: 'device-1',
    goal: 'recover me',
    status: 'running',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    steps: [],
    messages: [],
  };

  const persisted = [];
  const audits = [];

  const recovered = await recoverInProgressRunsOnStartup('fail', {
    async listInProgressRuns() {
      return [{ run, ownerUserId: 'user-1' }];
    },
    async persistRun(nextRun, ownerUserId) {
      persisted.push({ nextRun, ownerUserId });
    },
    async createAuditEvent(event) {
      audits.push(event);
    },
  });

  assert.equal(recovered, 1);
  assert.equal(run.status, 'failed');
  assert.equal(run.reason, 'server_restart');
  assert.equal(persisted.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].eventType, 'run.failed');
});
