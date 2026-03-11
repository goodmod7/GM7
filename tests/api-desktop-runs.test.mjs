import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_RUN_CONSTRAINTS } from '../packages/shared/dist/index.js';

const apiIndexPath = 'apps/api/src/index.ts';

test('desktop run routes authenticate with desktop device sessions and reuse shared run creation', async () => {
  const source = readFileSync(apiIndexPath, 'utf8');

  assert.match(
    source,
    /fastify\.get\('\/desktop\/me'/,
    'API should expose a desktop bootstrap endpoint'
  );

  assert.match(
    source,
    /fastify\.post\('\/desktop\/runs'/,
    'API should expose a desktop-authenticated run creation endpoint'
  );

  assert.match(
    source,
    /fastify\.get\('\/desktop\/me'[\s\S]*requireDesktopDeviceSession\(request, reply\)/,
    'Desktop bootstrap should authenticate with the desktop device token'
  );

  assert.match(
    source,
    /fastify\.post\('\/desktop\/runs'[\s\S]*requireDesktopDeviceSession\(request, reply\)/,
    'Desktop run creation should authenticate with the desktop device token'
  );

  assert.match(
    source,
    /createRunForOwnedDevice\(/,
    'Desktop and web run creation should reuse the same helper'
  );

  const desktopRunRoute = source.match(/fastify\.post\('\/desktop\/runs'[\s\S]*?const created = await createRunForOwnedDevice\(/);
  assert.ok(desktopRunRoute, 'desktop run route should be readable from source');
  assert.doesNotMatch(
    desktopRunRoute[0],
    /requireActiveSubscription/,
    'desktop-first run creation should not require a paid subscription because free local AI is allowed'
  );
});

test('shared run creation persists the existing run model and dispatches run.start for desktop-initiated runs', async () => {
  const { createRunForOwnedDevice } = await import('../apps/api/dist/lib/run-creation.js');

  const dispatchCalls = [];
  const persistedRuns = [];
  const ownershipCalls = [];
  let createCount = 0;

  const runStore = {
    create({ deviceId, goal, mode, constraints }) {
      createCount += 1;
      return {
        runId: `run-${createCount}`,
        deviceId,
        goal,
        mode,
        status: 'queued',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [],
        messages: [],
        actionCount: 0,
        constraints,
      };
    },
  };

  const ownership = {
    setRunOwner(runId, userId) {
      ownershipCalls.push({ runId, userId });
    },
  };

  const runsRepo = {
    async save(run, ownerUserId) {
      persistedRuns.push({ run, ownerUserId });
    },
  };

  const result = await createRunForOwnedDevice({
    userId: 'user-1',
    device: {
      deviceId: 'desktop-1',
      connected: true,
      paired: true,
    },
    goal: 'Investigate the failed deploy and summarize the fix',
    mode: 'ai_assist',
    runStore,
    ownership,
    runsRepo,
    dispatchRunStart: async (deviceId, payload) => {
      dispatchCalls.push({ deviceId, payload });
      return { queued: false, delivered: true };
    },
  });

  assert.equal(result.run.deviceId, 'desktop-1');
  assert.equal(result.run.mode, 'ai_assist');
  assert.deepEqual(result.run.constraints, DEFAULT_RUN_CONSTRAINTS);
  assert.deepEqual(ownershipCalls, [{ runId: result.run.runId, userId: 'user-1' }]);
  assert.equal(persistedRuns.length, 1);
  assert.equal(persistedRuns[0].ownerUserId, 'user-1');
  assert.equal(persistedRuns[0].run.runId, result.run.runId);
  assert.deepEqual(dispatchCalls, [
    {
      deviceId: 'desktop-1',
      payload: {
        runId: result.run.runId,
        goal: 'Investigate the failed deploy and summarize the fix',
        mode: 'ai_assist',
        constraints: DEFAULT_RUN_CONSTRAINTS,
      },
    },
  ]);
});
