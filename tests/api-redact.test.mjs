import assert from 'node:assert/strict';
import test from 'node:test';

test('redact masks token-like keys and sensitive headers recursively', async () => {
  const { redact } = await import('../apps/api/dist/lib/redact.js');

  const input = {
    headers: {
      authorization: 'Bearer top-secret',
      cookie: 'access_token=abc',
      'x-admin-api-key': 'admin-secret',
      'x-request-id': 'req-123',
    },
    accessToken: 'access-secret',
    nested: {
      password: 'plaintext',
      apiKey: 'internal-secret',
      safe: 'keep-me',
    },
    array: [
      { refreshToken: 'refresh-secret' },
      { safe: 'still-here' },
    ],
    err: Object.assign(new Error('boom'), {
      stripeSecret: 'sk_test_secret',
    }),
  };

  const result = redact(input);

  assert.notEqual(result, input);
  assert.equal(result.headers.authorization, '[REDACTED]');
  assert.equal(result.headers.cookie, '[REDACTED]');
  assert.equal(result.headers['x-admin-api-key'], '[REDACTED]');
  assert.equal(result.headers['x-request-id'], 'req-123');
  assert.equal(result.accessToken, '[REDACTED]');
  assert.equal(result.nested.password, '[REDACTED]');
  assert.equal(result.nested.apiKey, '[REDACTED]');
  assert.equal(result.nested.safe, 'keep-me');
  assert.equal(result.array[0].refreshToken, '[REDACTED]');
  assert.equal(result.array[1].safe, 'still-here');
  assert.equal(result.err.stripeSecret, '[REDACTED]');

  assert.equal(input.headers.authorization, 'Bearer top-secret');
  assert.equal(input.nested.password, 'plaintext');
});
