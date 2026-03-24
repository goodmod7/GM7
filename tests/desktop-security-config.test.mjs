import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const tauriConfigPath = 'apps/desktop/src-tauri/tauri.conf.json';
const capabilityPath = 'apps/desktop/src-tauri/capabilities/default.json';
const permissionPath = 'apps/desktop/src-tauri/permissions/desktop-ipc.toml';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseTomlStringArray(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedKey}\\s*=\\s*\\[(.*?)\\]`, 's'));
  if (!match) {
    return [];
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

test('desktop production security config is locked down', () => {
  const config = readJson(tauriConfigPath);
  const security = config?.app?.security ?? {};
  const build = config?.build ?? {};
  const plugins = config?.plugins ?? {};

  assert.equal(build.removeUnusedCommands, true, 'desktop build must enable removeUnusedCommands');

  assert.deepEqual(
    security.capabilities,
    ['default'],
    'desktop must explicitly enable only the default capability'
  );

  assert.equal(typeof security.csp, 'string');
  assert.ok(security.csp.length > 0, 'production CSP must be non-empty');
  assert.match(security.csp, /default-src 'self'/);
  assert.doesNotMatch(security.csp, /\*/, 'production CSP must not contain wildcard sources');
  assert.doesNotMatch(security.csp, /https:\/\/\*/, 'production CSP must not allow arbitrary HTTPS origins');
  assert.doesNotMatch(security.csp, /wss:\/\/\*/, 'production CSP must not allow arbitrary WSS origins');
  assert.doesNotMatch(security.csp, /'unsafe-eval'/, 'production CSP must not allow unsafe-eval');

  assert.equal(typeof security.devCsp, 'string');
  assert.ok(security.devCsp.includes('http://localhost:*'), 'dev CSP must permit localhost HTTP');
  assert.ok(security.devCsp.includes('ws://localhost:*'), 'dev CSP must permit localhost WS');

  assert.ok(existsSync(capabilityPath), 'desktop capability file must exist');
  assert.ok(existsSync(permissionPath), 'desktop IPC permission file must exist');

  const capability = readJson(capabilityPath);
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(
    capability.permissions,
    [
      'core:app:allow-version',
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'desktop-ipc',
      'updater:allow-check',
      'updater:allow-download',
      'updater:allow-install',
      'process:allow-restart',
    ],
    'capability permissions must stay narrowly scoped while allowing the audited updater flow'
  );

  const permissionSource = readFileSync(permissionPath, 'utf8');
  const permissionIdentifiers = [...permissionSource.matchAll(/identifier\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(permissionIdentifiers, ['desktop-ipc']);
  assert.deepEqual(parseTomlStringArray(permissionSource, 'commands.deny'), []);

  assert.equal(
    Object.prototype.hasOwnProperty.call(plugins, 'shell'),
    false,
    'shell plugin must not be enabled'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(plugins, 'fs'),
    false,
    'filesystem plugin must not be enabled'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(plugins, 'cli'),
    false,
    'cli plugin must not be enabled'
  );
});
