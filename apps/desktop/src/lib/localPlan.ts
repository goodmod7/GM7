import type { DesktopBillingSnapshot } from './desktopTasks.js';

export type LocalAiPlan = 'free' | 'plus';

export interface LocalAiPlanPolicy {
  plan: LocalAiPlan;
  localTaskLimit: number | null;
  visionBoostIncluded: boolean;
}

export interface LocalAiTaskUsage {
  dayKey: string;
  tasksStarted: number;
}

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const LOCAL_AI_USAGE_STORAGE_KEY = 'ai-operator-local-ai-usage';

export function getLocalAiPlanPolicy(billing: DesktopBillingSnapshot | null | undefined): LocalAiPlanPolicy {
  if (billing?.localAiPlan === 'plus') {
    return {
      plan: 'plus',
      localTaskLimit: null,
      visionBoostIncluded: true,
    };
  }

  return {
    plan: 'free',
    localTaskLimit: billing?.freeLocalTaskLimit ?? 5,
    visionBoostIncluded: Boolean(billing?.visionBoostIncluded),
  };
}

export function getTodayUsageKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function readLocalAiTaskUsage(storage: MinimalStorage, dayKey: string = getTodayUsageKey()): LocalAiTaskUsage {
  const raw = storage.getItem(LOCAL_AI_USAGE_STORAGE_KEY);
  if (!raw) {
    return { dayKey, tasksStarted: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalAiTaskUsage>;
    if (parsed.dayKey !== dayKey) {
      return { dayKey, tasksStarted: 0 };
    }
    return {
      dayKey,
      tasksStarted: typeof parsed.tasksStarted === 'number' ? parsed.tasksStarted : 0,
    };
  } catch {
    return { dayKey, tasksStarted: 0 };
  }
}

export function recordManagedLocalTaskStart(
  storage: MinimalStorage,
  dayKey: string = getTodayUsageKey()
): LocalAiTaskUsage {
  const current = readLocalAiTaskUsage(storage, dayKey);
  const next = {
    dayKey,
    tasksStarted: current.tasksStarted + 1,
  };
  storage.setItem(LOCAL_AI_USAGE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function canStartManagedLocalTask(
  policy: LocalAiPlanPolicy,
  usage: LocalAiTaskUsage
): { allowed: boolean; reason?: string; remaining: number | null } {
  if (policy.localTaskLimit == null) {
    return {
      allowed: true,
      remaining: null,
    };
  }

  const remaining = Math.max(0, policy.localTaskLimit - usage.tasksStarted);
  if (usage.tasksStarted >= policy.localTaskLimit) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Free plan limit reached for today. Upgrade to Plus for unlimited local tasks and Vision Boost.`,
    };
  }

  return {
    allowed: true,
    remaining,
  };
}
