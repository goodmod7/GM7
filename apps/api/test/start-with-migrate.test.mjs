import assert from 'node:assert/strict';
import test from 'node:test';

import { runStartup } from '../scripts/start-with-migrate.mjs';

test('runStartup migrates before starting the API', async () => {
  const calls = [];

  await runStartup({
    cwd: '/tmp/api-service',
    env: { DATABASE_URL: 'postgresql://example' },
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
    },
  });

  assert.deepEqual(calls, [
    {
      command: 'pnpm',
      args: ['exec', 'prisma', 'migrate', 'deploy'],
      options: {
        cwd: '/tmp/api-service',
        env: { DATABASE_URL: 'postgresql://example' },
      },
    },
    {
      command: 'node',
      args: ['dist/index.js'],
      options: {
        cwd: '/tmp/api-service',
        env: { DATABASE_URL: 'postgresql://example' },
      },
    },
  ]);
});

test('runStartup stops if migrate deploy fails', async () => {
  const calls = [];

  await assert.rejects(
    runStartup({
      cwd: '/tmp/api-service',
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (command === 'pnpm') {
          throw new Error('migrate failed');
        }
      },
    }),
    /migrate failed/
  );

  assert.deepEqual(calls, [
    {
      command: 'pnpm',
      args: ['exec', 'prisma', 'migrate', 'deploy'],
    },
  ]);
});
