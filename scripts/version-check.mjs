import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readText(path) {
  return readFileSync(path, 'utf8').trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readCargoVersion(path) {
  const content = readFileSync(path, 'utf8');
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not parse Cargo version from ${path}`);
  }
  return match[1];
}

const rootDir = process.cwd();
const rootVersionPath = resolve(rootDir, 'VERSION');
const rootVersion = readText(rootVersionPath);

const versions = {
  root: rootVersion,
  apiPackage: readJson(resolve(rootDir, 'apps/api/package.json')).version,
  desktopPackage: readJson(resolve(rootDir, 'apps/desktop/package.json')).version,
  tauriConfig: readJson(resolve(rootDir, 'apps/desktop/src-tauri/tauri.conf.json')).version,
  cargoPackage: readCargoVersion(resolve(rootDir, 'apps/desktop/src-tauri/Cargo.toml')),
};

const mismatches = Object.entries(versions)
  .filter(([name, value]) => name !== 'root' && value !== rootVersion)
  .map(([name, value]) => `${name}=${value} (expected ${rootVersion})`);

if (mismatches.length > 0) {
  console.error('Version mismatch detected:');
  for (const line of mismatches) {
    console.error(`- ${line}`);
  }
  process.exit(1);
}

console.log(`Version check passed: ${rootVersion}`);
