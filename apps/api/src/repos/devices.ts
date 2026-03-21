import type { ControlState, Device, Platform, ScreenStreamState, WorkspaceState } from '@ai-operator/shared';
import { prisma } from '../db/prisma.js';
import {
  getDesktopDeviceSessionExpiryDate,
  hashDesktopDeviceToken,
} from '../lib/desktop-session.js';

type DeviceRow = Awaited<ReturnType<typeof prisma.device.findUniqueOrThrow>>;

function hasActiveDeviceSession(row: DeviceRow, at: Date = new Date()): boolean {
  const revokedAt = row.deviceTokenRevokedAt?.getTime();
  if (revokedAt && revokedAt <= at.getTime()) {
    return false;
  }

  const expiresAt = row.deviceTokenExpiresAt?.getTime();
  if (expiresAt && expiresAt <= at.getTime()) {
    return false;
  }

  return Boolean(row.ownerUserId && (row.deviceTokenHash || row.deviceToken));
}

function rowToDevice(row: DeviceRow): Device {
  return {
    deviceId: row.id,
    deviceName: row.deviceName ?? undefined,
    platform: row.platform as Platform,
    appVersion: row.appVersion ?? undefined,
    connected: false,
    paired: hasActiveDeviceSession(row),
    pairingCode: row.pairingCode ?? undefined,
    pairingExpiresAt: row.pairingExpiresAt?.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    controlState: {
      enabled: row.controlEnabled,
      updatedAt: row.updatedAt.getTime(),
    },
    screenStreamState: row.screenStreamEnabled
      ? {
          enabled: true,
          fps: row.screenFps === 2 ? 2 : 1,
          displayId: row.screenDisplayId ?? undefined,
        }
      : undefined,
    workspaceState: row.workspaceRootName
      ? {
          configured: true,
          rootName: row.workspaceRootName,
        }
      : { configured: false },
  };
}

export const devicesRepo = {
  async loadAll() {
    const rows = await prisma.device.findMany();
    return rows.map((row) => ({
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
      deviceTokenHash: row.deviceTokenHash,
      deviceTokenIssuedAt: row.deviceTokenIssuedAt,
      deviceTokenExpiresAt: row.deviceTokenExpiresAt,
      deviceTokenLastUsedAt: row.deviceTokenLastUsedAt,
      deviceTokenRevokedAt: row.deviceTokenRevokedAt,
    }));
  },

  async upsertHello(input: {
    deviceId: string;
    deviceName?: string;
    platform: Platform;
    appVersion?: string;
    ownerUserId?: string | null;
  }) {
    const row = await prisma.device.upsert({
      where: { id: input.deviceId },
      update: {
        deviceName: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion,
        lastSeenAt: new Date(),
        ownerUserId: input.ownerUserId ?? undefined,
      },
      create: {
        id: input.deviceId,
        deviceName: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion,
        ownerUserId: input.ownerUserId ?? null,
        lastSeenAt: new Date(),
      },
    });

    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
      deviceTokenHash: row.deviceTokenHash,
      deviceTokenIssuedAt: row.deviceTokenIssuedAt,
      deviceTokenExpiresAt: row.deviceTokenExpiresAt,
      deviceTokenLastUsedAt: row.deviceTokenLastUsedAt,
      deviceTokenRevokedAt: row.deviceTokenRevokedAt,
    };
  },

  async findByDeviceId(deviceId: string) {
    const row = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!row) return null;
    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
      deviceTokenHash: row.deviceTokenHash,
      deviceTokenIssuedAt: row.deviceTokenIssuedAt,
      deviceTokenExpiresAt: row.deviceTokenExpiresAt,
      deviceTokenLastUsedAt: row.deviceTokenLastUsedAt,
      deviceTokenRevokedAt: row.deviceTokenRevokedAt,
    };
  },

  async findByDeviceToken(deviceToken: string) {
    const tokenHash = hashDesktopDeviceToken(deviceToken);
    let row = await prisma.device.findFirst({
      where: { deviceTokenHash: tokenHash },
    });

    if (!row) {
      row = await prisma.device.findUnique({ where: { deviceToken } });
    }

    if (!row) return null;

    if (!row.deviceTokenHash && row.deviceToken === deviceToken) {
      const now = new Date();
      await prisma.device.update({
        where: { id: row.id },
        data: {
          deviceToken: null,
          deviceTokenHash: tokenHash,
          deviceTokenIssuedAt: row.deviceTokenIssuedAt ?? row.pairedAt ?? now,
          deviceTokenExpiresAt: row.deviceTokenExpiresAt ?? getDesktopDeviceSessionExpiryDate(now),
          deviceTokenLastUsedAt: row.deviceTokenLastUsedAt ?? now,
          deviceTokenRevokedAt: null,
          updatedAt: now,
        },
      });
      row = await prisma.device.findUnique({ where: { id: row.id } });
      if (!row) {
        return null;
      }
    }

    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
      deviceTokenHash: row.deviceTokenHash,
      deviceTokenIssuedAt: row.deviceTokenIssuedAt,
      deviceTokenExpiresAt: row.deviceTokenExpiresAt,
      deviceTokenLastUsedAt: row.deviceTokenLastUsedAt,
      deviceTokenRevokedAt: row.deviceTokenRevokedAt,
    };
  },

  async setPairingCode(deviceId: string, pairingCode: string, expiresAt: number) {
    const row = await prisma.device.update({
      where: { id: deviceId },
      data: {
        pairingCode,
        pairingExpiresAt: new Date(expiresAt),
        lastSeenAt: new Date(),
      },
    });
    return rowToDevice(row as DeviceRow);
  },

  async claimDevice(deviceId: string, ownerUserId: string, deviceToken: string) {
    const now = new Date();
    const row = await prisma.device.upsert({
      where: { id: deviceId },
      update: {
        ownerUserId,
        pairedAt: now,
        deviceToken: null,
        deviceTokenHash: hashDesktopDeviceToken(deviceToken),
        deviceTokenIssuedAt: now,
        deviceTokenExpiresAt: getDesktopDeviceSessionExpiryDate(now),
        deviceTokenLastUsedAt: now,
        deviceTokenRevokedAt: null,
        pairingCode: null,
        pairingExpiresAt: null,
        updatedAt: now,
      },
      create: {
        id: deviceId,
        ownerUserId,
        deviceName: null,
        platform: 'unknown',
        appVersion: null,
        deviceToken: null,
        deviceTokenHash: hashDesktopDeviceToken(deviceToken),
        deviceTokenIssuedAt: now,
        deviceTokenExpiresAt: getDesktopDeviceSessionExpiryDate(now),
        deviceTokenLastUsedAt: now,
        deviceTokenRevokedAt: null,
        pairingCode: null,
        pairingExpiresAt: null,
        pairedAt: now,
        lastSeenAt: now,
        controlEnabled: false,
        screenStreamEnabled: false,
      },
    });
    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
      deviceTokenHash: row.deviceTokenHash,
      deviceTokenIssuedAt: row.deviceTokenIssuedAt,
      deviceTokenExpiresAt: row.deviceTokenExpiresAt,
      deviceTokenLastUsedAt: row.deviceTokenLastUsedAt,
      deviceTokenRevokedAt: row.deviceTokenRevokedAt,
    };
  },

  async touchDeviceSession(deviceId: string, at: Date) {
    await prisma.device.updateMany({
      where: {
        id: deviceId,
        ownerUserId: {
          not: null,
        },
      },
      data: {
        deviceTokenLastUsedAt: at,
      },
    });
  },

  async revokeDeviceSession(deviceId: string, deviceToken: string, at = new Date()) {
    const tokenHash = hashDesktopDeviceToken(deviceToken);
    const result = await prisma.device.updateMany({
      where: {
        id: deviceId,
        OR: [
          { deviceTokenHash: tokenHash },
          { deviceToken: deviceToken },
        ],
      },
      data: {
        deviceToken: null,
        deviceTokenHash: tokenHash,
        deviceTokenLastUsedAt: at,
        deviceTokenExpiresAt: at,
        deviceTokenRevokedAt: at,
        updatedAt: at,
      },
    });

    if (result.count === 0) {
      return null;
    }

    const row = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!row) {
      return null;
    }

    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
      deviceTokenHash: row.deviceTokenHash,
      deviceTokenIssuedAt: row.deviceTokenIssuedAt,
      deviceTokenExpiresAt: row.deviceTokenExpiresAt,
      deviceTokenLastUsedAt: row.deviceTokenLastUsedAt,
      deviceTokenRevokedAt: row.deviceTokenRevokedAt,
    };
  },

  async revokeOwnedDeviceSession(deviceId: string, ownerUserId: string) {
    const now = new Date();
    const result = await prisma.device.updateMany({
      where: {
        id: deviceId,
        ownerUserId,
      },
      data: {
        deviceToken: null,
        deviceTokenExpiresAt: now,
        deviceTokenRevokedAt: now,
        deviceTokenLastUsedAt: now,
        updatedAt: now,
      },
    });

    if (result.count === 0) {
      return null;
    }

    const row = await prisma.device.findFirst({
      where: {
        id: deviceId,
        ownerUserId,
      },
    });

    if (!row) {
      return null;
    }

    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
      deviceTokenHash: row.deviceTokenHash,
      deviceTokenIssuedAt: row.deviceTokenIssuedAt,
      deviceTokenExpiresAt: row.deviceTokenExpiresAt,
      deviceTokenLastUsedAt: row.deviceTokenLastUsedAt,
      deviceTokenRevokedAt: row.deviceTokenRevokedAt,
    };
  },

  async updateLastSeen(deviceId: string) {
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date() },
    });
  },

  async updateControlState(deviceId: string, state: ControlState) {
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        controlEnabled: state.enabled,
        updatedAt: new Date(state.updatedAt),
        lastSeenAt: new Date(),
      },
    });
  },

  async updateScreenStreamState(deviceId: string, state: ScreenStreamState) {
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        screenStreamEnabled: state.enabled,
        screenDisplayId: state.displayId ?? null,
        screenFps: state.enabled ? state.fps : null,
        updatedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  },

  async updateWorkspaceState(deviceId: string, state: WorkspaceState) {
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        workspaceRootName: state.configured ? state.rootName ?? null : null,
        updatedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  },

  async listOwned(ownerUserId: string) {
    const rows = await prisma.device.findMany({
      where: { ownerUserId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => rowToDevice(row as DeviceRow));
  },

  async getOwned(deviceId: string, ownerUserId: string) {
    const row = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId },
    });
    return row ? rowToDevice(row as DeviceRow) : null;
  },
};
