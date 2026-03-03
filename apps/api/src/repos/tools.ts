import { Prisma } from '@prisma/client';
import type { ToolSummary } from '@ai-operator/shared';
import { prisma } from '../db/prisma.js';

function serializeTool(tool: ToolSummary) {
  return {
    id: tool.toolEventId,
    deviceId: tool.deviceId,
    runId: tool.runId ?? null,
    tool: tool.tool,
    status: tool.status,
    summaryJson: {
      toolCallId: tool.toolCallId,
      pathRel: tool.pathRel,
      cmd: tool.cmd,
      exitCode: tool.exitCode,
      truncated: tool.truncated,
      bytesWritten: tool.bytesWritten,
      hunksApplied: tool.hunksApplied,
      errorCode: tool.errorCode,
      at: tool.at,
    } as unknown as Prisma.InputJsonValue,
    createdAt: new Date(tool.at),
    updatedAt: new Date(tool.at),
  };
}

function mapTool(row: any): ToolSummary {
  const summary = row.summaryJson as {
    toolCallId?: string;
    pathRel?: string;
    cmd?: string;
    exitCode?: number;
    truncated?: boolean;
    bytesWritten?: number;
    hunksApplied?: number;
    errorCode?: string;
    at?: number;
  };

  return {
    toolEventId: row.id,
    toolCallId: summary.toolCallId ?? row.id,
    runId: row.runId ?? undefined,
    deviceId: row.deviceId,
    tool: row.tool as ToolSummary['tool'],
    pathRel: summary.pathRel,
    cmd: summary.cmd,
    status: row.status as ToolSummary['status'],
    exitCode: summary.exitCode,
    truncated: summary.truncated,
    bytesWritten: summary.bytesWritten,
    hunksApplied: summary.hunksApplied,
    errorCode: summary.errorCode,
    at: summary.at ?? row.updatedAt.getTime(),
  };
}

export const toolsRepo = {
  async loadAll() {
    const rows = await prisma.toolEvent.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      tool: mapTool(row),
      ownerUserId: row.ownerUserId,
    }));
  },

  async save(tool: ToolSummary, ownerUserId: string) {
    const data = serializeTool(tool);
    await prisma.toolEvent.upsert({
      where: { id: tool.toolEventId },
      update: { ...data, ownerUserId } as Prisma.ToolEventUncheckedUpdateInput,
      create: { ...data, ownerUserId } as Prisma.ToolEventUncheckedCreateInput,
    });
  },

  async listOwnedByRun(runId: string, ownerUserId: string, limit: number) {
    const rows = await prisma.toolEvent.findMany({
      where: { runId, ownerUserId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => mapTool(row));
  },

  async listOwnedByDevice(deviceId: string, ownerUserId: string, limit: number) {
    const rows = await prisma.toolEvent.findMany({
      where: { deviceId, ownerUserId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => mapTool(row));
  },
};
