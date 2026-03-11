import type { Device, RunMode, RunWithSteps } from '@ai-operator/shared';
import type { DesktopApiRuntimeConfig } from './desktopRuntimeConfig.js';

export interface DesktopBillingSnapshot {
  subscriptionStatus: 'active' | 'inactive';
  subscriptionCurrentPeriodEnd: string | null;
  planPriceId: string | null;
  localAiPlan: 'free' | 'plus';
  freeLocalTaskLimit: number | null;
  visionBoostIncluded: boolean;
}

export interface DesktopTaskBootstrap {
  user: {
    id: string;
    email: string;
  };
  billing: DesktopBillingSnapshot;
  device: Device;
  runs: RunWithSteps[];
  activeRun: RunWithSteps | null;
  readiness: {
    billingEnabled: boolean;
    subscriptionStatus: 'active' | 'inactive';
  };
}

async function desktopTaskFetchJson<T>(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string,
  path: '/desktop/me' | '/desktop/runs',
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

export async function getDesktopTaskBootstrap(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string
): Promise<DesktopTaskBootstrap> {
  const data = await desktopTaskFetchJson<{ ok: true } & DesktopTaskBootstrap>(
    runtimeConfig,
    deviceToken,
    '/desktop/me'
  );

  return {
    user: data.user,
    billing: data.billing,
    device: data.device,
    runs: data.runs,
    activeRun: data.activeRun,
    readiness: data.readiness,
  };
}

export async function createDesktopRun(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string,
  input: {
    goal: string;
    mode: RunMode;
  }
): Promise<RunWithSteps> {
  const data = await desktopTaskFetchJson<{ ok: true; run: RunWithSteps }>(
    runtimeConfig,
    deviceToken,
    '/desktop/runs',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );

  return data.run;
}
