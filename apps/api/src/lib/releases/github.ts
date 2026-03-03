import { config } from '../../config.js';

export interface GitHubReleaseAsset {
  name: string;
  size: number;
  contentType?: string | null;
  browserDownloadUrl: string;
  apiUrl: string;
}

export interface GitHubRelease {
  tagName: string;
  publishedAt: string | null;
  body: string;
  assets: GitHubReleaseAsset[];
}

export interface GitHubReleaseResult {
  release: GitHubRelease;
  cacheHit: boolean;
}

type CacheEntry<T> = {
  updatedAt: number;
  expiresAt: number;
  value: T;
};

const releaseCache = new Map<string, CacheEntry<GitHubRelease>>();
const assetTextCache = new Map<string, CacheEntry<string>>();

function getRepoPath(): string {
  if (!config.GITHUB_REPO_OWNER || !config.GITHUB_REPO_NAME) {
    throw new Error('GitHub desktop releases are not configured');
  }

  return `/repos/${config.GITHUB_REPO_OWNER}/${config.GITHUB_REPO_NAME}`;
}

function getCacheTtlMs(): number {
  return Math.max(1, config.DESKTOP_RELEASE_CACHE_TTL_SECONDS) * 1000;
}

function getGithubHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ai-operator-api',
    ...extra,
  };

  if (config.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchGitHubJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: getGithubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function normalizeRelease(data: any): GitHubRelease {
  return {
    tagName: typeof data.tag_name === 'string' ? data.tag_name : 'unknown',
    publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
    body: typeof data.body === 'string' ? data.body : '',
    assets: Array.isArray(data.assets)
      ? data.assets.map((asset: any) => ({
          name: typeof asset.name === 'string' ? asset.name : 'unknown',
          size: typeof asset.size === 'number' ? asset.size : 0,
          contentType: typeof asset.content_type === 'string' ? asset.content_type : null,
          browserDownloadUrl:
            typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
          apiUrl: typeof asset.url === 'string' ? asset.url : '',
        }))
      : [],
  };
}

async function getOrFetchRelease(cacheKey: string, path: string): Promise<GitHubReleaseResult> {
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      release: cached.value,
      cacheHit: true,
    };
  }

  const release = normalizeRelease(await fetchGitHubJson<any>(path));
  releaseCache.set(cacheKey, {
    updatedAt: Date.now(),
    value: release,
    expiresAt: Date.now() + getCacheTtlMs(),
  });

  return {
    release,
    cacheHit: false,
  };
}

export async function fetchDesktopRelease(): Promise<GitHubReleaseResult> {
  const repoPath = getRepoPath();
  const releaseTag = config.DESKTOP_RELEASE_TAG.trim();

  if (!releaseTag || releaseTag === 'latest') {
    return getOrFetchRelease('latest', `${repoPath}/releases/latest`);
  }

  return getOrFetchRelease(`tag:${releaseTag}`, `${repoPath}/releases/tags/${encodeURIComponent(releaseTag)}`);
}

export async function fetchReleaseAssetText(asset: GitHubReleaseAsset): Promise<string> {
  const cacheKey = asset.apiUrl || asset.browserDownloadUrl;
  const cached = assetTextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = asset.apiUrl || asset.browserDownloadUrl;
  if (!url) {
    throw new Error(`Release asset ${asset.name} is missing a download URL`);
  }

  const response = await fetch(url, {
    headers: asset.apiUrl
      ? getGithubHeaders({ Accept: 'application/octet-stream' })
      : getGithubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub asset download failed (${response.status})`);
  }

  const text = await response.text();
  assetTextCache.set(cacheKey, {
    updatedAt: Date.now(),
    value: text,
    expiresAt: Date.now() + getCacheTtlMs(),
  });

  return text;
}

export function getGitHubReleaseCacheStats(): { enabled: boolean; ageSeconds: number | null } {
  if (config.DESKTOP_RELEASE_SOURCE !== 'github') {
    return { enabled: false, ageSeconds: null };
  }

  let latestUpdatedAt: number | null = null;
  for (const entry of releaseCache.values()) {
    if (!latestUpdatedAt || entry.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = entry.updatedAt;
    }
  }

  return {
    enabled: true,
    ageSeconds: latestUpdatedAt ? Math.max(0, Math.floor((Date.now() - latestUpdatedAt) / 1000)) : null,
  };
}
