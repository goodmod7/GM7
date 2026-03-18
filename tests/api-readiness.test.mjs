import assert from 'node:assert/strict';
import test from 'node:test';

test('readiness is healthy when DB probing succeeds and required config is present', async () => {
  const { evaluateReadiness } = await import('../apps/api/dist/lib/readiness.js');

  const readiness = await evaluateReadiness({
    billingEnabled: true,
    desktopReleaseSource: 'github',
    stripe: {
      secretKeyConfigured: true,
      webhookSecretConfigured: true,
      priceIdConfigured: true,
    },
    github: {
      repoConfigured: true,
    },
    checkDatabase: async () => {},
    checkSchema: async () => {},
  });

  assert.equal(readiness.ok, true);
  assert.deepEqual(readiness.failures, []);
  assert.equal(readiness.checks.db, true);
  assert.equal(readiness.checks.schema, true);
  assert.equal(readiness.checks.stripe, true);
  assert.equal(readiness.checks.github, true);
});

test('readiness reports concrete failures when DB probing fails or provider config is incomplete', async () => {
  const { evaluateReadiness } = await import('../apps/api/dist/lib/readiness.js');

  const readiness = await evaluateReadiness({
    billingEnabled: true,
    desktopReleaseSource: 'github',
    stripe: {
      secretKeyConfigured: true,
      webhookSecretConfigured: false,
      priceIdConfigured: true,
    },
    github: {
      repoConfigured: false,
    },
    checkDatabase: async () => {
      throw new Error('db offline');
    },
    checkSchema: async () => {
      throw new Error('schema mismatch');
    },
  });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.checks.db, false);
  assert.equal(readiness.checks.schema, false);
  assert.equal(readiness.checks.stripe, false);
  assert.equal(readiness.checks.github, false);
  assert.match(readiness.failures.join(' | '), /database/i);
  assert.match(readiness.failures.join(' | '), /stripe/i);
  assert.match(readiness.failures.join(' | '), /github/i);
});

test('readiness fails when GitHub desktop release metadata cannot be resolved', async () => {
  const { evaluateReadiness } = await import('../apps/api/src/lib/readiness.ts');

  const readiness = await evaluateReadiness({
    billingEnabled: false,
    desktopReleaseSource: 'github',
    stripe: {
      secretKeyConfigured: false,
      webhookSecretConfigured: false,
      priceIdConfigured: false,
    },
    github: {
      repoConfigured: true,
    },
    checkGitHubRelease: async () => {
      throw new Error('release not found');
    },
    checkDatabase: async () => {},
    checkSchema: async () => {},
  });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.checks.github, false);
  assert.match(readiness.failures.join(' | '), /desktop release/i);
});
