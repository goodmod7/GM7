import { Prisma } from '@prisma/client';
import type { DeviceAction } from '@ai-operator/shared';
import { prisma } from '../db/prisma.js';

function serializeAction(action: DeviceAction) {
  return {
    id: action.actionId,
    deviceId: action.deviceId,
    runId: action.runId ?? null,
    kind: action.action.kind,
    status: action.status,
    source: action.source ?? 'web',
    errorCode: action.error?.code ?? null,
    redactedSummaryJson: {
      action: action.action.kind === 'type'
        ? { kind: 'type', length: action.action.text.length }
        : action.action.kind === 'hotkey'
        ? { kind: 'hotkey', key: action.action.key, modifiers: action.action.modifiers ?? [] }
        : action.action,
    } as unknown as Prisma.InputJsonValue,
    createdAt: new Date(action.createdAt),
    updatedAt: new Date(action.updatedAt),
  };
}

function rowToAction(row: any): DeviceAction {
  const summary = row.redactedSummaryJson as { action?: Record<string, unknown> } | null;
  const redactedAction = summary?.action;

  let action: DeviceAction['action'];
  if (redactedAction?.kind === 'type') {
    const length = typeof redactedAction.length === 'number' ? redactedAction.length : 0;
    action = { kind: 'type', text: ''.padEnd(length, '*') };
  } else if (redactedAction) {
    action = redactedAction as unknown as DeviceAction['action'];
  } else {
    action = { kind: row.kind } as DeviceAction['action'];
  }

  return {
    actionId: row.id,
    deviceId: row.deviceId,
    action,
    status: row.status as DeviceAction['status'],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    error: row.errorCode ? { code: row.errorCode, message: '' } : undefined,
    source: row.source as DeviceAction['source'],
    runId: row.runId ?? undefined,
  };
}

export const actionsRepo = {
  async loadAll() {
    const rows = await prisma.action.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      action: rowToAction(row),
      ownerUserId: row.ownerUserId,
    }));
  },

  async save(action: DeviceAction, ownerUserId: string) {
    const data = serializeAction(action);
    await prisma.action.upsert({
      where: { id: action.actionId },
      update: { ...data, ownerUserId } as Prisma.ActionUncheckedUpdateInput,
      create: { ...data, ownerUserId } as Prisma.ActionUncheckedCreateInput,
    });
  },

  async listOwnedByDevice(deviceId: string, ownerUserId: string, limit: number) {
    const rows = await prisma.action.findMany({
      where: { deviceId, ownerUserId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => rowToAction(row));
  },
};
