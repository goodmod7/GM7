import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

const versionCandidates = [
  resolve(process.cwd(), 'VERSION'),
  resolve(moduleDir, '../../../VERSION'),
];

function readVersionFile(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  const raw = readFileSync(path, 'utf8').trim();
  return raw || null;
}

function readJsonVersion(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function readCargoVersion(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  const match = readFileSync(path, 'utf8').match(/^version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

export function getAppVersion(): string {
  for (const candidate of versionCandidates) {
    const value = readVersionFile(candidate);
    if (value) {
      return value;
    }
  }

  return process.env.APP_VERSION?.trim() || '0.0.0';
}

export function getVersionDriftWarnings(): string[] {
  const rootVersion = getAppVersion();
  const comparisons: Record<string, string | null> = {
    apiPackage: readJsonVersion(resolve(moduleDir, '../../package.json')),
    desktopPackage: readJsonVersion(resolve(moduleDir, '../../../apps/desktop/package.json')),
    tauriConfig: readJsonVersion(resolve(moduleDir, '../../../apps/desktop/src-tauri/tauri.conf.json')),
    cargoPackage: readCargoVersion(resolve(moduleDir, '../../../apps/desktop/src-tauri/Cargo.toml')),
  };

  return Object.entries(comparisons)
    .filter(([, value]) => value && value !== rootVersion)
    .map(([name, value]) => `${name} version ${value} does not match root version ${rootVersion}`);
}
