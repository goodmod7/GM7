import assert from 'node:assert/strict';
import test from 'node:test';

test('security helpers apply headers consistently and disable caching on sensitive routes', async () => {
  const { getSecurityHeaders, shouldSetNoStoreCacheControl } = await import('../apps/api/dist/lib/security.js');

  const authHeaders = getSecurityHeaders({
    nodeEnv: 'production',
    routeUrl: '/auth/me',
  });
  const billingHeaders = getSecurityHeaders({
    nodeEnv: 'production',
    routeUrl: '/billing/checkout',
  });
  const downloadHeaders = getSecurityHeaders({
    nodeEnv: 'production',
    routeUrl: '/downloads/desktop',
  });
  const publicHeaders = getSecurityHeaders({
    nodeEnv: 'production',
    routeUrl: '/public',
  });

  for (const headers of [authHeaders, billingHeaders, downloadHeaders, publicHeaders]) {
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.match(headers['permissions-policy'], /accelerometer=\(\)/);
    assert.equal(headers['strict-transport-security'], 'max-age=15552000; includeSubDomains');
  }

  assert.equal(authHeaders['cache-control'], 'no-store');
  assert.equal(billingHeaders['cache-control'], 'no-store');
  assert.equal(downloadHeaders['cache-control'], 'no-store');
  assert.equal(publicHeaders['cache-control'], undefined);

  assert.equal(shouldSetNoStoreCacheControl('/updates/desktop/:platform/:arch/:currentVersion.json'), true);
  assert.equal(shouldSetNoStoreCacheControl('/public'), false);
});

test('production security validation rejects insecure origins unless explicitly allowed', async () => {
  const {
    DEFAULT_JSON_BODY_LIMIT,
    WEBHOOK_RAW_BODY_LIMIT,
    validateSecurityRuntimeConfig,
  } = await import('../apps/api/dist/lib/security.js');

  assert.equal(DEFAULT_JSON_BODY_LIMIT, 1024 * 1024);
  assert.equal(WEBHOOK_RAW_BODY_LIMIT, 256 * 1024);

  assert.throws(() => {
    validateSecurityRuntimeConfig({
      nodeEnv: 'production',
      allowInsecureDev: false,
      appBaseUrl: 'http://app.example.com',
      webOrigins: ['https://web.example.com'],
    });
  }, /APP_BASE_URL/i);

  assert.throws(() => {
    validateSecurityRuntimeConfig({
      nodeEnv: 'production',
      allowInsecureDev: false,
      appBaseUrl: 'https://app.example.com',
      webOrigins: ['http://web.example.com'],
    });
  }, /WEB_ORIGIN/i);

  assert.doesNotThrow(() => {
    validateSecurityRuntimeConfig({
      nodeEnv: 'production',
      allowInsecureDev: true,
      appBaseUrl: 'http://app.example.com',
      webOrigins: ['http://web.example.com'],
    });
  });
});
