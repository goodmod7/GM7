import assert from 'node:assert/strict';
import test from 'node:test';

test('runRetentionOnce prunes old audit events, stripe events, sessions, and terminal runs', async () => {
  const { runRetentionOnce } = await import('../apps/api/dist/lib/retention.js');
  const calls = [];

  const prisma = {
    auditEvent: {
      async deleteMany(args) {
        calls.push({ model: 'auditEvent', args });
        return { count: 11 };
      },
    },
    stripeEvent: {
      async deleteMany(args) {
        calls.push({ model: 'stripeEvent', args });
        return { count: 7 };
      },
    },
    session: {
      async deleteMany(args) {
        calls.push({ model: 'session', args });
        return { count: 5 };
      },
    },
    run: {
      async deleteMany(args) {
        calls.push({ model: 'run', args });
        return { count: 3 };
      },
    },
  };

  const now = new Date('2026-03-07T12:00:00.000Z');
  const result = await runRetentionOnce(prisma, {
    now,
    auditRetentionDays: 30,
    stripeEventRetentionDays: 30,
    sessionRetentionDays: 30,
    runRetentionDays: 90,
  });

  assert.deepEqual(result, {
    auditEventsDeleted: 11,
    stripeEventsDeleted: 7,
    sessionsDeleted: 5,
    runsDeleted: 3,
  });

  assert.deepEqual(calls, [
    {
      model: 'auditEvent',
      args: {
        where: {
          createdAt: {
            lt: new Date('2026-02-05T12:00:00.000Z'),
          },
        },
      },
    },
    {
      model: 'stripeEvent',
      args: {
        where: {
          createdAt: {
            lt: new Date('2026-02-05T12:00:00.000Z'),
          },
        },
      },
    },
    {
      model: 'session',
      args: {
        where: {
          OR: [
            {
              revokedAt: {
                lt: new Date('2026-02-05T12:00:00.000Z'),
              },
            },
            {
              expiresAt: {
                lt: new Date('2026-02-28T12:00:00.000Z'),
              },
            },
          ],
        },
      },
    },
    {
      model: 'run',
      args: {
        where: {
          status: {
            in: ['done', 'failed', 'canceled'],
          },
          updatedAt: {
            lt: new Date('2025-12-07T12:00:00.000Z'),
          },
        },
      },
    },
  ]);
});
