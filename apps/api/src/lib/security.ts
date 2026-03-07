import type { FastifyReply, FastifyRequest } from 'fastify';

export const DEFAULT_JSON_BODY_LIMIT = 1024 * 1024;
export const WEBHOOK_RAW_BODY_LIMIT = 256 * 1024;

export interface SecurityHeaderOptions {
  nodeEnv: string;
  routeUrl: string;
}

export interface SecurityRuntimeConfig {
  nodeEnv: string;
  allowInsecureDev: boolean;
  appBaseUrl: string;
  webOrigins: string[];
}

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()',
} as const;

function normalizeRouteUrl(routeUrl: string): string {
  return routeUrl.split('?')[0] || routeUrl;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function shouldSetNoStoreCacheControl(routeUrl: string): boolean {
  const normalized = normalizeRouteUrl(routeUrl);

  return (
    normalized.startsWith('/auth/') ||
    normalized === '/billing/checkout' ||
    normalized === '/billing/portal' ||
    normalized === '/downloads/desktop' ||
    normalized.startsWith('/updates/desktop/')
  );
}

export function getSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
  };

  if (options.nodeEnv === 'production') {
    headers['strict-transport-security'] = 'max-age=15552000; includeSubDomains';
  }

  if (shouldSetNoStoreCacheControl(options.routeUrl)) {
    headers['cache-control'] = 'no-store';
  }

  return headers;
}

export function createSecurityOnSendHook(options: { nodeEnv: string }) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const routeUrl = request.routeOptions?.url ?? normalizeRouteUrl(request.url);
    const headers = getSecurityHeaders({
      nodeEnv: options.nodeEnv,
      routeUrl,
    });

    for (const [name, value] of Object.entries(headers)) {
      reply.header(name, value);
    }
  };
}

export function validateSecurityRuntimeConfig(config: SecurityRuntimeConfig): void {
  if (config.nodeEnv !== 'production' || config.allowInsecureDev) {
    return;
  }

  if (!isHttpsUrl(config.appBaseUrl)) {
    throw new Error('APP_BASE_URL must use https:// in production unless ALLOW_INSECURE_DEV=true');
  }

  const invalidOrigin = config.webOrigins.find((origin) => !isHttpsUrl(origin.trim()));
  if (invalidOrigin) {
    throw new Error(
      `WEB_ORIGIN must use https:// in production unless ALLOW_INSECURE_DEV=true: ${invalidOrigin}`
    );
  }
}
