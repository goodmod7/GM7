import type { FastifyInstance } from 'fastify';

interface RootRouteOptions {
  appVersion: string;
  apiPublicBaseUrl: string;
  nodeEnv: string;
}

function buildLink(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

export function registerRootRoute(fastify: FastifyInstance, options: RootRouteOptions): void {
  fastify.get('/', async () => ({
    name: 'AI Operator API',
    status: 'ok' as const,
    version: options.appVersion,
    environment: options.nodeEnv,
    links: {
      health: buildLink(options.apiPublicBaseUrl, 'health'),
      ready: buildLink(options.apiPublicBaseUrl, 'ready'),
      metrics: buildLink(options.apiPublicBaseUrl, 'metrics'),
    },
  }));
}
