import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const apiIndexPath = 'apps/api/src/index.ts';
const helperPath = 'apps/api/src/lib/desktop-account.ts';

test('desktop account routes authenticate with desktop sessions and expose device management primitives', async () => {
  const source = readFileSync(apiIndexPath, 'utf8');

  assert.match(
    source,
    /fastify\.get\('\/desktop\/account'/,
    'API should expose a desktop account bootstrap route'
  );

  assert.match(
    source,
    /fastify\.post\('\/desktop\/devices\/:deviceId\/revoke'/,
    'API should expose a desktop device revoke route'
  );

  assert.match(
    source,
    /fastify\.get\('\/desktop\/account'[\s\S]*requireDesktopDeviceSession\(request, reply\)/,
    'Desktop account bootstrap should authenticate with the current desktop device token'
  );

  assert.match(
    source,
    /fastify\.post\('\/desktop\/devices\/:deviceId\/revoke'[\s\S]*requireDesktopDeviceSession\(request, reply\)/,
    'Desktop device revoke should authenticate with the current desktop device token'
  );
});

test('desktop account helper builds current-device-first account snapshots and preserves sibling sessions', async () => {
  const { buildDesktopAccountSnapshot } = await import('../apps/api/dist/lib/desktop-account.js');

  const snapshot = await buildDesktopAccountSnapshot({
    user: {
      id: 'user-1',
      email: 'operator@example.com',
      subscriptionStatus: 'active',
      subscriptionCurrentPeriodEnd: null,
      planPriceId: 'price_basic',
    },
    currentDeviceId: 'desktop-b',
    listOwnedDevices: async () => ([
      {
        deviceId: 'desktop-a',
        deviceName: 'Workstation A',
        connected: true,
        paired: true,
        platform: 'macos',
        lastSeenAt: Date.now(),
      },
      {
        deviceId: 'desktop-b',
        deviceName: 'Workstation B',
        connected: true,
        paired: true,
        platform: 'windows',
        lastSeenAt: Date.now(),
      },
    ]),
  });

  assert.equal(snapshot.currentDevice?.deviceId, 'desktop-b');
  assert.deepEqual(
    snapshot.devices.map((device) => device.deviceId),
    ['desktop-b', 'desktop-a'],
    'current desktop should be first without dropping sibling desktop sessions'
  );
  assert.equal(snapshot.billing.subscriptionStatus, 'active');
});
