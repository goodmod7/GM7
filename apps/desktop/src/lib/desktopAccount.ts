import type { Device } from '@ai-operator/shared';
import type { DesktopApiRuntimeConfig } from './desktopRuntimeConfig.js';
import type { DesktopBillingSnapshot } from './desktopTasks.js';

export interface DesktopAccountSnapshot {
  user: {
    id: string;
    email: string;
  };
  billing: DesktopBillingSnapshot;
  currentDevice: Device | null;
  devices: Device[];
}

async function desktopAccountFetchJson<T>(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${runtimeConfig.httpBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`,
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({ error: 'Request failed' }));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Request failed');
  }

  return data as T;
}

export async function getDesktopAccount(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string
): Promise<DesktopAccountSnapshot> {
  const data = await desktopAccountFetchJson<{ ok: true } & DesktopAccountSnapshot>(
    runtimeConfig,
    deviceToken,
    '/desktop/account'
  );

  return {
    user: data.user,
    billing: data.billing,
    currentDevice: data.currentDevice,
    devices: data.devices,
  };
}

export async function revokeDesktopDevice(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string,
  deviceId: string
): Promise<Device | null> {
  const data = await desktopAccountFetchJson<{ ok: true; device: Device | null }>(
    runtimeConfig,
    deviceToken,
    `/desktop/devices/${deviceId}/revoke`,
    {
      method: 'POST',
    }
  );

  return data.device;
}
