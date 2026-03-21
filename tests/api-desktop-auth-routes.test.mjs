import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const apiIndexPath = 'apps/api/src/index.ts';
const devicesRepoPath = 'apps/api/src/repos/devices.ts';

test('desktop auth only accepts exact loopback callback URLs', async () => {
  const { validateDesktopLoopbackCallbackUrl } = await import('../apps/api/dist/lib/desktop-auth.js');

  assert.deepEqual(
    validateDesktopLoopbackCallbackUrl('http://127.0.0.1:43123/auth/callback'),
    {
      ok: true,
      callbackUrl: 'http://127.0.0.1:43123/auth/callback',
    }
  );

  for (const callbackUrl of [
    'https://127.0.0.1:43123/auth/callback',
    'http://localhost:43123/auth/callback',
    'http://192.168.1.10:43123/auth/callback',
    'http://127.0.0.1/auth/callback',
    'http://127.0.0.1:43123',
    'http://user:pass@127.0.0.1:43123/auth/callback',
  ]) {
    assert.equal(
      validateDesktopLoopbackCallbackUrl(callbackUrl).ok,
      false,
      `expected ${callbackUrl} to be rejected`
    );
  }
});

test('desktop auth routes use the handoff helper and rotate device tokens through existing device ownership', () => {
  const source = readFileSync(apiIndexPath, 'utf8');
  const devicesRepoSource = readFileSync(devicesRepoPath, 'utf8');

  assert.match(
    source,
    /fastify\.post\('\/desktop\/auth\/start'/,
    'Expected a desktop auth start route'
  );

  assert.match(
    source,
    /validateDesktopLoopbackCallbackUrl\(callbackUrl\)/,
    'Desktop auth start should validate the exact loopback callback URL'
  );

  assert.match(
    source,
    /desktopAuth\.startAttempt\(\s*\{[\s\S]*deviceId,[\s\S]*callbackUrl:[\s\S]*state,[\s\S]*nonce,/,
    'Desktop auth start should register a handoff attempt bound to device, callback, state, and nonce'
  );

  assert.match(
    source,
    /fastify\.post\('\/desktop\/auth\/exchange'/,
    'Expected a desktop auth exchange route'
  );

  assert.match(
    source,
    /desktopAuth\.consumeHandoff\(\s*\{[\s\S]*handoffToken,[\s\S]*deviceId,[\s\S]*state,[\s\S]*nonce,/,
    'Desktop auth exchange should consume the one-time handoff token'
  );

  assert.match(
    source,
    /await devicesRepo\.claimDevice\(deviceId,\s*consumed\.userId,\s*deviceToken\)/,
    'Desktop auth exchange should rotate the durable device token through the existing device ownership path'
  );

  assert.doesNotMatch(
    source,
    /const persistedDevice = await devicesRepo\.findByDeviceId\(deviceId\);\s*if \(!persistedDevice\) {\s*reply\.status\(404\);\s*return \{ error: 'Device not found' \};\s*}/,
    'Desktop auth exchange should not fail only because a fresh install has not created its device row yet'
  );

  assert.match(
    devicesRepoSource,
    /async claimDevice\([\s\S]*prisma\.device\.upsert\(/,
    'claimDevice should upsert the device row so exchange can recover when the first websocket hello has not happened yet'
  );

  assert.match(
    devicesRepoSource,
    /deviceTokenHash/,
    'Desktop auth rotation should persist a hashed desktop token instead of keeping only a raw bearer secret'
  );

  assert.match(
    devicesRepoSource,
    /deviceTokenIssuedAt|deviceTokenExpiresAt|deviceTokenLastUsedAt|deviceTokenRevokedAt/,
    'Desktop auth rotation should stamp desktop session metadata for issue, expiry, use, and revoke tracking'
  );
});
