import type { RunWithSteps } from '@ai-operator/shared';

export type RunRecoveryPolicy = 'fail' | 'cancel';

export interface RecoverableRun {
  run: RunWithSteps;
  ownerUserId: string;
}

export interface RunRecoveryDeps {
  listInProgressRuns: () => Promise<RecoverableRun[]>;
  persistRun: (run: RunWithSteps, ownerUserId: string) => Promise<void>;
  createAuditEvent: (input: {
    userId: string;
    deviceId: string;
    runId: string;
    eventType: string;
    meta: Record<string, unknown>;
  }) => Promise<void>;
}

export async function recoverInProgressRunsOnStartup(
  policy: RunRecoveryPolicy,
  deps: RunRecoveryDeps
): Promise<number> {
  const recoverable = await deps.listInProgressRuns();

  for (const item of recoverable) {
    const nextStatus = policy === 'cancel' ? 'canceled' : 'failed';
    item.run.status = nextStatus;
    item.run.reason = 'server_restart';
    item.run.updatedAt = Date.now();

    await deps.persistRun(item.run, item.ownerUserId);
    await deps.createAuditEvent({
      userId: item.ownerUserId,
      deviceId: item.run.deviceId,
      runId: item.run.runId,
      eventType: `run.${nextStatus}`,
      meta: { reason: 'server_restart' },
    });
  }

  return recoverable.length;
}
