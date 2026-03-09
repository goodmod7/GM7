import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

import { registerRootRoute } from '../dist/lib/root-route.js';

test('GET / returns API service metadata and useful endpoints', async () => {
  const app = Fastify({ logger: false });
  registerRootRoute(app, {
    appVersion: '1.2.3',
    apiPublicBaseUrl: 'https://gm7.onrender.com',
    nodeEnv: 'production',
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');

    const payload = response.json();
    assert.deepEqual(payload, {
      name: 'AI Operator API',
      status: 'ok',
      version: '1.2.3',
      environment: 'production',
      links: {
        health: 'https://gm7.onrender.com/health',
        ready: 'https://gm7.onrender.com/ready',
        metrics: 'https://gm7.onrender.com/metrics',
      },
    });
  } finally {
    await app.close();
  }
});
