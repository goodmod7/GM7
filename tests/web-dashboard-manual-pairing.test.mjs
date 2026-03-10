import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardPath = 'apps/web/app/dashboard/legacy/page.tsx';

test('legacy dashboard includes a manual device pairing form for newly connected desktops', () => {
  const source = readFileSync(dashboardPath, 'utf8');

  assert.match(
    source,
    /Pair a desktop device/i,
    'Legacy dashboard should expose a manual pairing section for newly connected devices'
  );

  assert.match(
    source,
    /placeholder="Enter device ID"/,
    'Manual pairing form should include a device ID input'
  );

  assert.match(
    source,
    /placeholder="Enter pairing code"/,
    'Manual pairing form should include a pairing code input'
  );

  assert.match(
    source,
    /apiFetch\(`\/devices\/\$\{deviceId\}\/pair`/,
    'Manual pairing flow should submit to the existing device pair endpoint'
  );
});
