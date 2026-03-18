import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  validateDesktopDownloadsPayload,
  validateDesktopUpdateManifest,
} from '../apps/api/src/lib/releases/validation.ts';

const repoRoot = process.cwd();
const updateFixtures = [
  'apps/api/updates/desktop-darwin-aarch64.json',
  'apps/api/updates/desktop-darwin-x86_64.json',
  'apps/api/updates/desktop-windows-x86_64.json',
];

function applyApiReleaseEnv() {
  process.env.PORT ??= '3001';
  process.env.NODE_ENV ??= 'test';
  process.env.LOG_LEVEL ??= 'error';
  process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/ai_operator';
  process.env.JWT_SECRET ??= 'test-secret';
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';
  process.env.APP_BASE_URL ??= 'http://localhost:3000';
  process.env.API_PUBLIC_BASE_URL ??= 'http://localhost:3001';
  process.env.GITHUB_REPO_OWNER ??= 'goodmod7';
  process.env.GITHUB_REPO_NAME ??= 'GM7';
}

test('desktop release validators reject placeholder signatures and example download URLs', () => {
  assert.throws(
    () =>
      validateDesktopDownloadsPayload(
        {
          version: '0.1.0',
          windowsUrl: 'https://example.com/downloads/ai-operator-setup.exe',
          macIntelUrl: 'https://downloads.gorkh.example/app-intel.dmg',
          macArmUrl: 'https://downloads.gorkh.example/app-arm.dmg',
        },
        {
          nodeEnv: 'production',
          allowInsecureDev: false,
        },
      ),
    /placeholder|example/i,
  );

  assert.throws(
    () =>
      validateDesktopUpdateManifest(
        {
          version: '0.1.0',
          platforms: {
            'darwin-aarch64': {
              url: '/downloads/desktop/artifacts/ai-operator-0.1.0-aarch64.dmg',
              signature: 'replace-with-tauri-signature',
            },
          },
        },
        {
          target: 'darwin-aarch64',
          apiPublicBaseUrl: 'https://api.gorkh.example',
          nodeEnv: 'production',
          allowInsecureDev: false,
        },
      ),
    /signature/i,
  );
});

test('desktop release validators only allow localhost fixture downloads when insecure dev is enabled', () => {
  assert.throws(
    () =>
      validateDesktopDownloadsPayload(
        {
          version: '0.1.0',
          windowsUrl: 'http://localhost:3001/downloads/desktop/artifacts/ai-operator-0.1.0-x64-setup.exe',
          macIntelUrl: 'http://localhost:3001/downloads/desktop/artifacts/ai-operator-0.1.0-x64.dmg',
          macArmUrl: 'http://localhost:3001/downloads/desktop/artifacts/ai-operator-0.1.0-aarch64.dmg',
        },
        {
          nodeEnv: 'production',
          allowInsecureDev: false,
        },
      ),
    /localhost|https/i,
  );

  assert.doesNotThrow(() =>
    validateDesktopDownloadsPayload(
      {
        version: '0.1.0',
        windowsUrl: 'http://localhost:3001/downloads/desktop/artifacts/ai-operator-0.1.0-x64-setup.exe',
        macIntelUrl: 'http://localhost:3001/downloads/desktop/artifacts/ai-operator-0.1.0-x64.dmg',
        macArmUrl: 'http://localhost:3001/downloads/desktop/artifacts/ai-operator-0.1.0-aarch64.dmg',
      },
      {
        nodeEnv: 'production',
        allowInsecureDev: true,
      },
    ),
  );
});

test('checked-in update fixtures are safe for local smoke verification', () => {
  for (const relativePath of updateFixtures) {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
    const target = path.basename(relativePath, '.json').replace(/^desktop-/, '');

    assert.doesNotThrow(() =>
      validateDesktopUpdateManifest(manifest, {
        target,
        apiPublicBaseUrl: 'http://localhost:3001',
        nodeEnv: 'production',
        allowInsecureDev: true,
      }),
    );
  }
});

test('desktop downloads can be resolved from a beta release without updater signatures', async () => {
  applyApiReleaseEnv();
  const { resolveDesktopDownloadAssets } = await import('../apps/api/src/lib/releases/resolveDesktopAssets.ts');

  const release = {
    tagName: 'v0.1.0-beta.1',
    publishedAt: '2026-03-18T00:00:00.000Z',
    body: 'Beta release for internal testing.',
    assets: [
      {
        name: 'ai-operator-desktop_0.1.0-beta.1_windows_x86_64.msi',
        size: 10,
        browserDownloadUrl: 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_windows_x86_64.msi',
        apiUrl: 'https://api.github.com/assets/windows',
      },
      {
        name: 'ai-operator-desktop_0.1.0-beta.1_macos_x86_64.dmg',
        size: 10,
        browserDownloadUrl: 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_macos_x86_64.dmg',
        apiUrl: 'https://api.github.com/assets/macos-intel',
      },
      {
        name: 'ai-operator-desktop_0.1.0-beta.1_macos_aarch64.dmg',
        size: 10,
        browserDownloadUrl: 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_macos_aarch64.dmg',
        apiUrl: 'https://api.github.com/assets/macos-arm',
      },
    ],
  };

  const downloads = await resolveDesktopDownloadAssets(release);

  assert.equal(downloads.version, '0.1.0-beta.1');
  assert.equal(downloads.windowsUrl, 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_windows_x86_64.msi');
  assert.equal(downloads.macIntelUrl, 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_macos_x86_64.dmg');
  assert.equal(downloads.macArmUrl, 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_macos_aarch64.dmg');
});

test('updater manifests still require signature assets from GitHub releases', async () => {
  applyApiReleaseEnv();
  const { resolveDesktopAssets } = await import('../apps/api/src/lib/releases/resolveDesktopAssets.ts');

  const release = {
    tagName: 'v0.1.0-beta.1',
    publishedAt: '2026-03-18T00:00:00.000Z',
    body: 'Beta release for internal testing.',
    assets: [
      {
        name: 'ai-operator-desktop_0.1.0-beta.1_windows_x86_64.msi',
        size: 10,
        browserDownloadUrl: 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_windows_x86_64.msi',
        apiUrl: 'https://api.github.com/assets/windows',
      },
      {
        name: 'ai-operator-desktop_0.1.0-beta.1_macos_x86_64.dmg',
        size: 10,
        browserDownloadUrl: 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_macos_x86_64.dmg',
        apiUrl: 'https://api.github.com/assets/macos-intel',
      },
      {
        name: 'ai-operator-desktop_0.1.0-beta.1_macos_aarch64.dmg',
        size: 10,
        browserDownloadUrl: 'https://downloads.gorkh.app/ai-operator-desktop_0.1.0-beta.1_macos_aarch64.dmg',
        apiUrl: 'https://api.github.com/assets/macos-arm',
      },
    ],
  };

  await assert.rejects(() => resolveDesktopAssets(release), /Missing release asset/);
});
