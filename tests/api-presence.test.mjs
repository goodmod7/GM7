import assert from 'node:assert/strict';
import test from 'node:test';

test('presence fallback to memory stores and clears state', async () => {
  const presence = await import('../apps/api/dist/lib/presence.js');
  let fakeNow = Date.now();
  presence.__setNowProviderForTests(() => fakeNow);

  await presence.setPresence('memory', 'redis://localhost:6379', 'device-1', 'user-1', true);
  const current = await presence.getPresence('memory', 'redis://localhost:6379', 'device-1');

  assert.equal(current?.connected, true);
  assert.equal(current?.ownerUserId, 'user-1');
  assert.equal(typeof current?.lastSeenAt, 'number');

  fakeNow += 46_000;
  const expired = await presence.getPresence('memory', 'redis://localhost:6379', 'device-1');
  assert.equal(expired, null);

  await presence.clearPresence('memory', 'redis://localhost:6379', 'device-1');
  const cleared = await presence.getPresence('memory', 'redis://localhost:6379', 'device-1');
  assert.equal(cleared, null);
  presence.__resetNowProviderForTests();
});
