import { Prisma } from '@prisma/client';
import type { RunWithSteps } from '@ai-operator/shared';
import { prisma } from '../db/prisma.js';

function clampJson<T>(value: T): T {
  const json = JSON.stringify(value);
  if (json.length <= 20_000) {
    return value;
  }
  return JSON.parse(json.slice(0, 20_000)) as T;
}

function serializeRun(run: RunWithSteps) {
  return {
    id: run.runId,
    ownerUserId: '',
    deviceId: run.deviceId,
    goal: run.goal,
    mode: run.mode ?? 'manual',
    status: run.status,
    reason: run.reason ?? null,
    constraintsJson: run.constraints ? (clampJson(run.constraints) as unknown as Prisma.InputJsonValue) : undefined,
    actionCount: run.actionCount ?? 0,
    latestProposalJson: run.latestProposal ? (clampJson(run.latestProposal) as unknown as Prisma.InputJsonValue) : undefined,
    createdAt: new Date(run.createdAt),
    updatedAt: new Date(run.updatedAt),
  };
}

function mapRun(row: any): RunWithSteps {
  return {
    runId: row.id,
    deviceId: row.deviceId,
    goal: row.goal,
    status: row.status as RunWithSteps['status'],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    reason: row.reason ?? undefined,
    messages: [],
    mode: row.mode as RunWithSteps['mode'],
    constraints: row.constraintsJson ? ((row.constraintsJson as unknown) as RunWithSteps['constraints']) : undefined,
    actionCount: row.actionCount,
    latestProposal: row.latestProposalJson ? ((row.latestProposalJson as unknown) as RunWithSteps['latestProposal']) : undefined,
    steps: row.steps.map((step: any) => ({
      stepId: step.stepId,
      title: step.title,
      status: step.status as RunWithSteps['steps'][number]['status'],
      startedAt: step.startedAt?.getTime(),
      endedAt: step.endedAt?.getTime(),
      logs: (step.logsJson as RunWithSteps['steps'][number]['logs']) ?? [],
    })),
  };
}

export const runsRepo = {
  async save(run: RunWithSteps, ownerUserId: string) {
    const base = serializeRun(run);
    await prisma.$transaction(async (tx) => {
      await tx.run.upsert({
        where: { id: run.runId },
        update: {
          ownerUserId,
          deviceId: base.deviceId,
          goal: base.goal,
          mode: base.mode,
          status: base.status,
          reason: base.reason,
          constraintsJson: base.constraintsJson,
          actionCount: base.actionCount,
          latestProposalJson: base.latestProposalJson,
          createdAt: base.createdAt,
          updatedAt: base.updatedAt,
        } as Prisma.RunUncheckedUpdateInput,
        create: {
          ...base,
          ownerUserId,
        } as Prisma.RunUncheckedCreateInput,
      });

      await tx.runStep.deleteMany({ where: { runId: run.runId } });
      if (run.steps.length > 0) {
        await tx.runStep.createMany({
          data: run.steps.map((step) => ({
            runId: run.runId,
            stepId: step.stepId,
            title: step.title,
            status: step.status,
            logsJson: clampJson(step.logs.slice(-100)) as unknown as Prisma.InputJsonValue,
            startedAt: step.startedAt ? new Date(step.startedAt) : null,
            endedAt: step.endedAt ? new Date(step.endedAt) : null,
          })) as Prisma.RunStepCreateManyInput[],
        });
      }
    });
  },

  async loadAll() {
    const rows = await prisma.run.findMany({
      include: { steps: { orderBy: { stepId: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      run: mapRun(row),
      ownerUserId: row.ownerUserId,
    }));
  },

  async listOwned(ownerUserId: string) {
    const rows = await prisma.run.findMany({
      where: { ownerUserId },
      include: { steps: { orderBy: { stepId: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => mapRun(row));
  },

  async getOwned(runId: string, ownerUserId: string) {
    const row = await prisma.run.findFirst({
      where: { id: runId, ownerUserId },
      include: { steps: { orderBy: { stepId: 'asc' } } },
    });
    return row ? mapRun(row) : null;
  },

  async listInProgressRuns() {
    const rows = await prisma.run.findMany({
      where: { status: { in: ['running', 'waiting_for_user'] } },
      include: { steps: { orderBy: { stepId: 'asc' } } },
      orderBy: { updatedAt: 'asc' },
    });

    return rows.map((row) => ({
      run: mapRun(row),
      ownerUserId: row.ownerUserId,
    }));
  },
};
