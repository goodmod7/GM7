import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const tauriConfigPath = path.join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json');
const iconDir = path.join(repoRoot, 'apps/desktop/src-tauri/icons');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
const mainWindow = tauriConfig.app?.windows?.find((window) => window.label === 'main');

test('desktop bundle is configured for macOS glass window support', () => {
  assert.equal(tauriConfig.app?.macOSPrivateApi, true);
  assert.equal(mainWindow?.transparent, true);
  assert.ok(['Overlay', 'Transparent'].includes(mainWindow?.titleBarStyle));
});

test('desktop bundle ships branded macOS icon assets', () => {
  assert.ok(Array.isArray(tauriConfig.bundle?.icon));
  assert.ok(tauriConfig.bundle.icon.includes('icons/icon.icns'));
  assert.ok(fs.existsSync(path.join(iconDir, 'icon.icns')));
  assert.ok(fs.existsSync(path.join(iconDir, 'icon.svg')));
});
