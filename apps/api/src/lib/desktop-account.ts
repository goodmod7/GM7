import type { Device } from '@ai-operator/shared';

interface DesktopAccountUser {
  id: string;
  email: string;
  subscriptionStatus?: string | null;
  subscriptionCurrentPeriodEnd?: Date | null;
  planPriceId?: string | null;
}

interface BuildDesktopAccountSnapshotInput {
  user: DesktopAccountUser;
  currentDeviceId: string;
  listOwnedDevices: () => Promise<Device[]>;
}

export async function buildDesktopAccountSnapshot(input: BuildDesktopAccountSnapshotInput) {
  const devices = await input.listOwnedDevices();
  const sortedDevices = [...devices].sort((left, right) => {
    if (left.deviceId === input.currentDeviceId) {
      return -1;
    }
    if (right.deviceId === input.currentDeviceId) {
      return 1;
    }
    return right.lastSeenAt - left.lastSeenAt;
  });

  const currentDevice = sortedDevices.find((device) => device.deviceId === input.currentDeviceId) ?? null;

  return {
    user: {
      id: input.user.id,
      email: input.user.email,
    },
    billing: {
      subscriptionStatus: input.user.subscriptionStatus === 'active' ? 'active' : 'inactive',
      subscriptionCurrentPeriodEnd: input.user.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
      planPriceId: input.user.planPriceId ?? null,
    },
    currentDevice,
    devices: sortedDevices,
  };
}
