const DEFAULT_DEV_HTTP_BASE = 'http://localhost:3001';
const DEFAULT_DEV_WS_URL = 'ws://localhost:3001/ws';

export interface DesktopApiRuntimeConfig {
  httpBase: string;
  wsUrl: string;
  allowInsecureLocalhost: boolean;
  production: boolean;
}

export type DesktopApiRuntimeValidation =
  | {
      ok: true;
      config: DesktopApiRuntimeConfig;
    }
  | {
      ok: false;
      message: string;
      issues: string[];
    };

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function effectivePort(url: URL): string {
  if (url.port) {
    return url.port;
  }

  if (url.protocol === 'https:' || url.protocol === 'wss:') {
    return '443';
  }

  return '80';
}

export function validateDesktopRuntimeConfig(
  env: ImportMetaEnv = import.meta.env
): DesktopApiRuntimeValidation {
  const production = Boolean(env.PROD);
  const allowInsecureLocalhost = env.VITE_DESKTOP_ALLOW_INSECURE_LOCALHOST === 'true';
  const httpBaseRaw = env.VITE_API_HTTP_BASE || DEFAULT_DEV_HTTP_BASE;
  const wsUrlRaw = env.VITE_API_WS_URL || DEFAULT_DEV_WS_URL;
  const issues: string[] = [];

  let httpBase: URL;
  let wsUrl: URL;

  try {
    httpBase = new URL(httpBaseRaw);
  } catch {
    return {
      ok: false,
      message: `Desktop API configuration is invalid: VITE_API_HTTP_BASE is not a valid URL (${httpBaseRaw}).`,
      issues: ['VITE_API_HTTP_BASE must be a valid absolute URL.'],
    };
  }

  try {
    wsUrl = new URL(wsUrlRaw);
  } catch {
    return {
      ok: false,
      message: `Desktop API configuration is invalid: VITE_API_WS_URL is not a valid URL (${wsUrlRaw}).`,
      issues: ['VITE_API_WS_URL must be a valid absolute URL.'],
    };
  }

  if (!['http:', 'https:'].includes(httpBase.protocol)) {
    issues.push('VITE_API_HTTP_BASE must use http:// or https://.');
  }

  if (!['ws:', 'wss:'].includes(wsUrl.protocol)) {
    issues.push('VITE_API_WS_URL must use ws:// or wss://.');
  }

  if (httpBase.hostname !== wsUrl.hostname || effectivePort(httpBase) !== effectivePort(wsUrl)) {
    issues.push('VITE_API_HTTP_BASE and VITE_API_WS_URL must target the same host and port.');
  }

  if (production) {
    const httpIsLocal = isLocalhost(httpBase.hostname);
    const wsIsLocal = isLocalhost(wsUrl.hostname);

    if (httpBase.protocol !== 'https:') {
      issues.push('Production desktop builds require VITE_API_HTTP_BASE to use https://.');
    }

    if (wsUrl.protocol !== 'wss:') {
      issues.push('Production desktop builds require VITE_API_WS_URL to use wss://.');
    }

    if (!allowInsecureLocalhost && (httpIsLocal || wsIsLocal)) {
      issues.push('Production desktop builds reject localhost API endpoints unless VITE_DESKTOP_ALLOW_INSECURE_LOCALHOST=true.');
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      message: `Desktop API configuration is invalid: ${issues.join(' ')}`,
      issues,
    };
  }

  return {
    ok: true,
    config: {
      httpBase: httpBase.toString().replace(/\/$/, ''),
      wsUrl: wsUrl.toString(),
      allowInsecureLocalhost,
      production,
    },
  };
}

export const desktopRuntimeConfig = validateDesktopRuntimeConfig();
