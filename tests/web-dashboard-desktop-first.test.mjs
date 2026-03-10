import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardPath = 'apps/web/app/dashboard/page.tsx';
const legacyPagePath = 'apps/web/app/dashboard/legacy/page.tsx';

test('primary web dashboard is desktop-first and no longer exposes legacy pairing/run creation as the main surface', () => {
  const source = readFileSync(dashboardPath, 'utf8');

  assert.match(source, /Use the desktop app to start tasks|Desktop is the primary place to start tasks/i);
  assert.match(source, /Downloads|Billing|Devices|Account/i);

  assert.doesNotMatch(
    source,
    /Pair a desktop device|Create Run/,
    'primary dashboard should not expose pairing or web run creation directly'
  );

  assert.match(
    source,
    /Admin \/ Legacy Tools|Legacy Tools|Migration fallback/i,
    'primary dashboard should point to clearly labeled legacy tools'
  );
});

test('legacy web tools remain available behind a dedicated admin or legacy surface', () => {
  assert.equal(existsSync(legacyPagePath), true, 'legacy dashboard surface should exist');

  const source = readFileSync(legacyPagePath, 'utf8');

  assert.match(source, /Admin \/ Legacy Tools|Legacy Tools/i);
  assert.match(source, /Pair a desktop device/i);
  assert.match(source, /Create Run/i);
  assert.match(source, /debug|fallback|older desktop builds/i);
});
