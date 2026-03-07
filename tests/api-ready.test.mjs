import assert from 'node:assert/strict';
import test from 'node:test';

test('readiness returns not ok when database probe fails', async () => {
  const { evaluateReadiness } = await import('../apps/api/dist/lib/readiness.js');

  const report = await evaluateReadiness({
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
    checkDatabase: async () => {
      throw new Error('db down');
    },
    checkSchema: async () => {
      // no-op
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.db, false);
});
