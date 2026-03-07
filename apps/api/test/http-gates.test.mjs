import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

function applyApiEnv() {
  process.env.PORT = process.env.PORT || '3001';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ai_operator';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  process.env.ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '30m';
  process.env.REFRESH_TOKEN_TTL_DAYS = process.env.REFRESH_TOKEN_TTL_DAYS || '14';
  process.env.CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'csrf_token';
  process.env.ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || 'access_token';
  process.env.REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'refresh_token';
  process.env.WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:3000';
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_value';
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_value';
  process.env.STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_test_value';
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
  process.env.API_PUBLIC_BASE_URL = process.env.API_PUBLIC_BASE_URL || 'http://localhost:3001';
}

applyApiEnv();

const [authModule, subscriptionModule, usersRepoModule, ownershipModule, deviceStoreModule, runStoreModule] =
  await Promise.all([
    import('../dist/lib/auth.js'),
    import('../dist/lib/subscription.js'),
    import('../dist/repos/users.js'),
    import('../dist/lib/ownership.js'),
    import('../dist/store/devices.js'),
    import('../dist/store/runs.js'),
  ]);

const {
  shouldCheckCsrf,
  isValidCsrf,
  requireAuth,
  issueAccessToken,
} = authModule;
const { requireActiveSubscription } = subscriptionModule;
const { usersRepo } = usersRepoModule;
const { ownership } = ownershipModule;
const { deviceStore } = deviceStoreModule;
const { runStore } = runStoreModule;

async function withServer(run) {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  app.addHook('preHandler', async (request, reply) => {
    if (!shouldCheckCsrf(request)) {
      return;
    }

    if (isValidCsrf(request)) {
      return;
    }

    reply.status(403);
    return reply.send({
      error: 'CSRF token required',
      code: 'CSRF_REQUIRED',
    });
  });

  app.post('/mutation', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return { error: 'Unauthorized' };
    }
    return { ok: true, userId: user.id };
  });

  app.post('/runs', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return { error: 'Unauthorized' };
    }

    if (!(await requireActiveSubscription(request, reply, user))) {
      return;
    }

    reply.status(201);
    return { ok: true };
  });

  app.get('/devices/:deviceId', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return { error: 'Unauthorized' };
    }

    const { deviceId } = request.params;
    const device = deviceStore.get(deviceId);
    if (!device || ownership.getDeviceOwner(deviceId) !== user.id) {
      reply.status(404);
      return { error: 'Device not found' };
    }

    return { device };
  });

  app.get('/runs/:runId', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return { error: 'Unauthorized' };
    }

    const { runId } = request.params;
    const run = runStore.get(runId);
    if (!run || ownership.getRunOwner(runId) !== user.id) {
      reply.status(404);
      return { error: 'Run not found' };
    }

    return { run };
  });

  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test('cookie-authenticated mutation requires CSRF header', async () => {
  const accessToken = issueAccessToken({
    id: 'csrf-user',
    email: 'csrf@example.com',
  });

  await withServer(async (app) => {
    const response = await app.inject({
      method: 'POST',
      url: '/mutation',
      headers: {
        Cookie: `access_token=${accessToken}; csrf_token=csrf-cookie-value`,
      },
    });

    assert.equal(response.statusCode, 403);
    const payload = JSON.parse(response.body);
    assert.equal(payload.code, 'CSRF_REQUIRED');
  });
});

test('bearer-authenticated mutation bypasses CSRF and succeeds', async () => {
  const accessToken = issueAccessToken({
    id: 'bearer-user',
    email: 'bearer@example.com',
  });

  await withServer(async (app) => {
    const response = await app.inject({
      method: 'POST',
      url: '/mutation',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.userId, 'bearer-user');
  });
});

test('inactive subscription receives 402 on POST /runs', async () => {
  const originalGetBilling = usersRepo.getBilling;
  usersRepo.getBilling = async () => ({ subscriptionStatus: 'inactive' });

  const accessToken = issueAccessToken({
    id: 'inactive-user',
    email: 'inactive@example.com',
  });

  try {
    await withServer(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        payload: JSON.stringify({
          deviceId: 'any-device',
          goal: 'test',
        }),
      });

      assert.equal(response.statusCode, 402);
      const payload = JSON.parse(response.body);
      assert.equal(payload.code, 'SUBSCRIPTION_REQUIRED');
    });
  } finally {
    usersRepo.getBilling = originalGetBilling;
  }
});

test('ownership filtering hides devices and runs from non-owners', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerUserId = `owner-${suffix}`;
  const otherUserId = `other-${suffix}`;
  const deviceId = `device-${suffix}`;

  deviceStore.upsert({
    deviceId,
    platform: 'linux',
    connected: true,
  });
  ownership.setDeviceOwner(deviceId, ownerUserId);

  const run = runStore.create({
    deviceId,
    goal: 'ownership gate check',
  });
  ownership.setRunOwner(run.runId, ownerUserId);

  const token = issueAccessToken({
    id: otherUserId,
    email: 'other@example.com',
  });

  await withServer(async (app) => {
    const deviceRes = await app.inject({
      method: 'GET',
      url: `/devices/${deviceId}`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(deviceRes.statusCode, 404);

    const runRes = await app.inject({
      method: 'GET',
      url: `/runs/${run.runId}`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(runRes.statusCode, 404);
  });
});
