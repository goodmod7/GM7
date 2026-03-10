import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const signInDocPath = 'docs/desktop-signin-flow.md';
const migrationDocPath = 'docs/migration-pairing-to-signin.md';

test('desktop sign-in flow doc exists and documents the secure browser handoff', () => {
  assert.equal(existsSync(signInDocPath), true, 'desktop sign-in flow doc should exist');
  const source = readFileSync(signInDocPath, 'utf8');

  assert.match(source, /system browser|external browser/i);
  assert.match(source, /loopback/i);
  assert.match(source, /handoff token/i);
  assert.match(source, /single-use|single use/i);
  assert.match(source, /sign out|revoke/i);
});

test('pairing migration doc exists and explains desktop-first posture with legacy web fallback', () => {
  assert.equal(existsSync(migrationDocPath), true, 'migration doc should exist');
  const source = readFileSync(migrationDocPath, 'utf8');

  assert.match(source, /desktop-first|desktop first/i);
  assert.match(source, /pairing/i);
  assert.match(source, /legacy|admin|fallback/i);
  assert.match(source, /multi-device|multiple desktops/i);
});
