import { redact } from './redact.js';

export const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const EXPIRED_SESSION_GRACE_DAYS = 7;

interface DeleteManyResult {
  count: number;
}

export interface RetentionPrismaClient {
  auditEvent: {
    deleteMany(args: { where: { createdAt: { lt: Date } } }): Promise<DeleteManyResult>;
  };
  stripeEvent: {
    deleteMany(args: { where: { createdAt: { lt: Date } } }): Promise<DeleteManyResult>;
  };
  session: {
    deleteMany(args: {
      where: {
        OR: Array<
          | { revokedAt: { lt: Date } }
          | { expiresAt: { lt: Date } }
        >;
      };
    }): Promise<DeleteManyResult>;
  };
  run: {
    deleteMany(args: {
      where: {
        status: { in: string[] };
        updatedAt: { lt: Date };
      };
    }): Promise<DeleteManyResult>;
  };
}

export interface RetentionRunOptions {
  now?: Date;
  auditRetentionDays?: number;
  stripeEventRetentionDays?: number;
  sessionRetentionDays?: number;
  runRetentionDays?: number;
}

export interface RetentionSummary {
  auditEventsDeleted: number;
  stripeEventsDeleted: number;
  sessionsDeleted: number;
  runsDeleted: number;
}

interface LoggerLike {
  info(payload: unknown, message?: string): void;
  error(payload: unknown, message?: string): void;
}

export interface RetentionSchedulerOptions extends RetentionRunOptions {
  nodeEnv: string;
  prismaClient: RetentionPrismaClient;
  logger?: LoggerLike;
  intervalMs?: number;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function runRetentionOnce(
  prismaClient: RetentionPrismaClient,
  options: RetentionRunOptions = {}
): Promise<RetentionSummary> {
  const now = options.now ?? new Date();
  const auditCutoff = daysAgo(now, options.auditRetentionDays ?? 30);
  const stripeEventCutoff = daysAgo(now, options.stripeEventRetentionDays ?? 30);
  const revokedSessionCutoff = daysAgo(now, options.sessionRetentionDays ?? 30);
  const expiredSessionCutoff = daysAgo(now, EXPIRED_SESSION_GRACE_DAYS);
  const runCutoff = daysAgo(now, options.runRetentionDays ?? 90);

  const [auditResult, stripeEventResult, sessionResult, runResult] = await Promise.all([
    prismaClient.auditEvent.deleteMany({
      where: {
        createdAt: {
          lt: auditCutoff,
        },
      },
    }),
    prismaClient.stripeEvent.deleteMany({
      where: {
        createdAt: {
          lt: stripeEventCutoff,
        },
      },
    }),
    prismaClient.session.deleteMany({
      where: {
        OR: [
          {
            revokedAt: {
              lt: revokedSessionCutoff,
            },
          },
          {
            expiresAt: {
              lt: expiredSessionCutoff,
            },
          },
        ],
      },
    }),
    prismaClient.run.deleteMany({
      where: {
        status: {
          in: ['done', 'failed', 'canceled'],
        },
        updatedAt: {
          lt: runCutoff,
        },
      },
    }),
  ]);

  return {
    auditEventsDeleted: auditResult.count,
    stripeEventsDeleted: stripeEventResult.count,
    sessionsDeleted: sessionResult.count,
    runsDeleted: runResult.count,
  };
}

export function startRetentionScheduler(options: RetentionSchedulerOptions): (() => void) | null {
  if (options.nodeEnv === 'test') {
    return null;
  }

  const intervalMs = options.intervalMs ?? RETENTION_INTERVAL_MS;
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  let running = false;

  const runScheduledRetention = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const summary = await runRetentionOnce(options.prismaClient, options);
      options.logger?.info({ retention: summary }, 'Retention cleanup completed');
    } catch (err) {
      options.logger?.error({ err: redact(err) }, 'Retention cleanup failed');
    } finally {
      running = false;
    }
  };

  void runScheduledRetention();
  const timer = setIntervalImpl(() => {
    void runScheduledRetention();
  }, intervalMs);

  return () => {
    clearIntervalImpl(timer);
  };
}
