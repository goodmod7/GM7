import { prisma } from '../src/db/prisma.js';
import { config } from '../src/config.js';
import { runRetentionOnce } from '../src/lib/retention.js';

try {
  const summary = await runRetentionOnce(prisma, {
    auditRetentionDays: config.AUDIT_RETENTION_DAYS,
    stripeEventRetentionDays: config.STRIPE_EVENT_RETENTION_DAYS,
    sessionRetentionDays: config.SESSION_RETENTION_DAYS,
    runRetentionDays: config.RUN_RETENTION_DAYS,
  });

  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
} catch (err) {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
}
