import type { GitHubRelease, GitHubReleaseAsset } from './github.js';
import { fetchReleaseAssetText } from './github.js';

export interface ResolvedDesktopRelease {
  version: string;
  notes: string;
  publishedAt: string | null;
  windows: { url: string; signature: string };
  macIntel: { url: string; signature: string };
  macArm: { url: string; signature: string };
}

export type DesktopTarget = 'windows-x86_64' | 'macos-x86_64' | 'macos-aarch64';

const NOTES_MAX_LENGTH = 10_000;

function truncateNotes(notes: string): string {
  const trimmed = notes.trim();
  if (trimmed.length <= NOTES_MAX_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, NOTES_MAX_LENGTH)}…`;
}

function stripLeadingV(tagName: string): string {
  return tagName.startsWith('v') ? tagName.slice(1) : tagName;
}

export function buildDesktopAssetNames(version: string): Record<DesktopTarget, string> {
  return {
    'windows-x86_64': `ai-operator-desktop_${version}_windows_x86_64.msi`,
    'macos-x86_64': `ai-operator-desktop_${version}_macos_x86_64.dmg`,
    'macos-aarch64': `ai-operator-desktop_${version}_macos_aarch64.dmg`,
  };
}

function getRequiredAsset(release: GitHubRelease, name: string): GitHubReleaseAsset {
  const asset = release.assets.find((entry) => entry.name === name);
  if (!asset || !asset.browserDownloadUrl) {
    throw new Error(`Missing release asset: ${name}`);
  }

  return asset;
}

async function resolveSignedAsset(release: GitHubRelease, assetName: string) {
  const installerAsset = getRequiredAsset(release, assetName);
  const signatureAsset = getRequiredAsset(release, `${assetName}.sig`);
  const signature = (await fetchReleaseAssetText(signatureAsset)).trim();

  if (!signature) {
    throw new Error(`Signature asset is empty: ${signatureAsset.name}`);
  }

  return {
    url: installerAsset.browserDownloadUrl,
    signature,
  };
}

export async function resolveDesktopAssets(release: GitHubRelease): Promise<ResolvedDesktopRelease> {
  const version = stripLeadingV(release.tagName);
  const assetNames = buildDesktopAssetNames(version);

  return {
    version,
    notes: truncateNotes(release.body),
    publishedAt: release.publishedAt,
    windows: await resolveSignedAsset(release, assetNames['windows-x86_64']),
    macIntel: await resolveSignedAsset(release, assetNames['macos-x86_64']),
    macArm: await resolveSignedAsset(release, assetNames['macos-aarch64']),
  };
}
