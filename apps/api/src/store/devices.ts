import type { Device, Platform, ScreenStreamState, ControlState, WorkspaceState } from '@ai-operator/shared';

// In-memory device store
const devices = new Map<string, Device>();

export interface DeviceInput {
  deviceId: string;
  deviceName?: string;
  platform: Platform;
  appVersion?: string;
}

export const deviceStore = {
  load(devicesToLoad: Device[]): void {
    devices.clear();
    for (const device of devicesToLoad) {
      devices.set(device.deviceId, device);
    }
  },

  get(deviceId: string): Device | undefined {
    return devices.get(deviceId);
  },

  getAll(): Device[] {
    return Array.from(devices.values()).map((d) => ({ ...d, socket: undefined }));
  },

  upsert(input: DeviceInput & { connected: boolean; socket?: unknown }): Device {
    const existing = devices.get(input.deviceId);
    const now = Date.now();

    const device: Device = {
      ...existing,
      ...input,
      paired: existing?.paired ?? false,
      pairingCode: existing?.pairingCode,
      pairingExpiresAt: existing?.pairingExpiresAt,
      screenStreamState: existing?.screenStreamState,
      lastSeenAt: now,
    };

    devices.set(input.deviceId, device);
    return device;
  },

  setConnected(deviceId: string, connected: boolean, socket?: unknown): Device | undefined {
    const device = devices.get(deviceId);
    if (!device) return undefined;

    device.connected = connected;
    device.socket = connected ? socket : undefined;
    device.lastSeenAt = Date.now();

    return device;
  },

  setPairingCode(deviceId: string, pairingCode: string, expiresAt: number): Device | undefined {
    const device = devices.get(deviceId);
    if (!device) return undefined;

    device.pairingCode = pairingCode;
    device.pairingExpiresAt = expiresAt;
    device.lastSeenAt = Date.now();

    return device;
  },

  confirmPairing(deviceId: string, code: string): { success: true; device: Device } | { success: false; reason: 'not_found' | 'invalid_code' | 'expired' } {
    const device = devices.get(deviceId);
    if (!device) {
      return { success: false, reason: 'not_found' };
    }

    if (!device.pairingCode || device.pairingCode !== code) {
      return { success: false, reason: 'invalid_code' };
    }

    if (device.pairingExpiresAt && Date.now() > device.pairingExpiresAt) {
      return { success: false, reason: 'expired' };
    }

    device.paired = true;
    device.pairingCode = undefined;
    device.pairingExpiresAt = undefined;
    device.lastSeenAt = Date.now();

    return { success: true, device };
  },

  updateLastSeen(deviceId: string): Device | undefined {
    const device = devices.get(deviceId);
    if (device) {
      device.lastSeenAt = Date.now();
    }
    return device;
  },

  // Iteration 4: screen stream state
  setScreenStreamState(deviceId: string, state: ScreenStreamState): Device | undefined {
    const device = devices.get(deviceId);
    if (!device) return undefined;

    device.screenStreamState = state;
    device.lastSeenAt = Date.now();
    return device;
  },

  getScreenStreamState(deviceId: string): ScreenStreamState | undefined {
    return devices.get(deviceId)?.screenStreamState;
  },

  // Iteration 5: control state
  setControlState(deviceId: string, state: ControlState): Device | undefined {
    const device = devices.get(deviceId);
    if (!device) return undefined;

    device.controlState = state;
    device.lastSeenAt = Date.now();
    return device;
  },

  getControlState(deviceId: string): ControlState | undefined {
    return devices.get(deviceId)?.controlState;
  },

  // Iteration 7: workspace state
  setWorkspaceState(deviceId: string, state: WorkspaceState): Device | undefined {
    const device = devices.get(deviceId);
    if (!device) return undefined;

    device.workspaceState = state;
    device.lastSeenAt = Date.now();
    return device;
  },

  getWorkspaceState(deviceId: string): WorkspaceState | undefined {
    return devices.get(deviceId)?.workspaceState;
  },

  // Cleanup expired pairing codes (call periodically)
  cleanupExpiredPairingCodes(): number {
    const now = Date.now();
    let count = 0;

    for (const [, device] of devices) {
      if (!device.paired && device.pairingExpiresAt && now > device.pairingExpiresAt) {
        device.pairingCode = undefined;
        device.pairingExpiresAt = undefined;
        count++;
      }
    }

    return count;
  },

  // Mark all devices as disconnected (call on server shutdown)
  markAllDisconnected(): void {
    for (const device of devices.values()) {
      device.connected = false;
      device.socket = undefined;
    }
  },
};

// Cleanup expired pairing codes every minute
setInterval(() => {
  const cleaned = deviceStore.cleanupExpiredPairingCodes();
  if (cleaned > 0) {
    console.log(`[DeviceStore] Cleaned up ${cleaned} expired pairing codes`);
  }
}, 60_000);
