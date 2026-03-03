import type { ControlState, Device, Platform, ScreenStreamState, WorkspaceState } from '@ai-operator/shared';
import { prisma } from '../db/prisma.js';

type DeviceRow = Awaited<ReturnType<typeof prisma.device.findUniqueOrThrow>>;

function rowToDevice(row: DeviceRow): Device {
  return {
    deviceId: row.id,
    deviceName: row.deviceName ?? undefined,
    platform: row.platform as Platform,
    appVersion: row.appVersion ?? undefined,
    connected: false,
    paired: Boolean(row.ownerUserId && row.deviceToken),
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
    };
  },

  async findByDeviceId(deviceId: string) {
    const row = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!row) return null;
    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
    };
  },

  async findByDeviceToken(deviceToken: string) {
    const row = await prisma.device.findUnique({ where: { deviceToken } });
    if (!row) return null;
    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
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
    const row = await prisma.device.update({
      where: { id: deviceId },
      data: {
        ownerUserId,
        pairedAt: now,
        deviceToken,
        pairingCode: null,
        pairingExpiresAt: null,
        updatedAt: now,
      },
    });
    return {
      device: rowToDevice(row as DeviceRow),
      ownerUserId: row.ownerUserId,
      deviceToken: row.deviceToken,
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
