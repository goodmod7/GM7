import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const cargoTomlPath = path.join(repoRoot, 'apps/desktop/src-tauri/Cargo.toml');
const tauriConfigPath = path.join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json');
const libRsPath = path.join(repoRoot, 'apps/desktop/src-tauri/src/lib.rs');
const agentModPath = path.join(repoRoot, 'apps/desktop/src-tauri/src/agent/mod.rs');
const iconPath = path.join(repoRoot, 'apps/desktop/src-tauri/icons/icon.png');

test('desktop release cargo config includes required tray and error dependencies', () => {
  const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');

  assert.match(
    cargoToml,
    /^tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"tray-icon"[^\]]*\][^}]*\}/m,
    'desktop Tauri crate should enable the tray-icon feature',
  );

  assert.match(
    cargoToml,
    /^thiserror\s*=\s*".+"/m,
    'desktop Rust crate should declare thiserror for derive(Error) usage',
  );
});

test('desktop release config includes a tracked icon asset', () => {
  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));

  assert.ok(fs.existsSync(iconPath), 'desktop release should include src-tauri/icons/icon.png');
  assert.ok(
    Array.isArray(tauriConfig.bundle?.icon) &&
      tauriConfig.bundle.icon.includes('icons/icon.png'),
    'desktop release config should reference icons/icon.png explicitly',
  );
});

test('desktop rust sources avoid the broken API usage that blocked CI', () => {
  const libRs = fs.readFileSync(libRsPath, 'utf8');

  assert.ok(
    !libRs.includes('image.rgba()'),
    'desktop screen capture should not call image.rgba(); use raw RGBA bytes compatible with the screenshots crate',
  );

  assert.ok(
    !libRs.includes('mouse_double_click('),
    'desktop input injection should not call the unavailable Enigo mouse_double_click API',
  );
});

test('advanced agent module exports the runtime type used by Tauri commands', () => {
  const agentMod = fs.readFileSync(agentModPath, 'utf8');

  assert.match(
    agentMod,
    /pub struct AdvancedAgent\b/,
    'desktop advanced agent module should export AdvancedAgent for the Tauri command layer',
  );
});
