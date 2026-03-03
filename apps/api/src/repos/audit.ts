import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';

export interface AuditEventInput {
  userId?: string | null;
  deviceId?: string | null;
  runId?: string | null;
  actionId?: string | null;
  toolName?: string | null;
  eventType: string;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown> | null;
}

function clampMeta(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) {
    return null;
  }

  const json = JSON.stringify(meta);
  if (json.length <= 2_000) {
    return json;
  }

  return JSON.stringify({ truncated: true });
}

export const auditRepo = {
  async createEvent(input: AuditEventInput): Promise<void> {
    const metaJson = clampMeta(input.meta);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditEvent" ("id", "userId", "deviceId", "runId", "actionId", "toolName", "eventType", "ip", "userAgent", "meta")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS jsonb))`,
      randomUUID(),
      input.userId ?? null,
      input.deviceId ?? null,
      input.runId ?? null,
      input.actionId ?? null,
      input.toolName ?? null,
      input.eventType,
      input.ip ?? null,
      input.userAgent ?? null,
      metaJson
    );
  },
};
