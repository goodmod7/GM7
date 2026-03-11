import type { RunWithSteps } from '@ai-operator/shared';
import type { DesktopApiRuntimeConfig } from './desktopRuntimeConfig.js';
import { createDesktopRun } from './desktopTasks.js';

const ACTIVE_RUN_STATUSES = new Set<RunWithSteps['status']>([
  'queued',
  'running',
  'waiting_for_user',
]);

interface EnsureAssistantRunForMessageInput {
  message: string;
  activeRun: RunWithSteps | null;
  runtimeConfig: DesktopApiRuntimeConfig;
  deviceToken: string;
  createRun?: typeof createDesktopRun;
}

export function isAssistantRunActive(run: RunWithSteps | null | undefined): run is RunWithSteps {
  return Boolean(run && ACTIVE_RUN_STATUSES.has(run.status));
}

export async function ensureAssistantRunForMessage(
  input: EnsureAssistantRunForMessageInput
): Promise<RunWithSteps> {
  if (isAssistantRunActive(input.activeRun)) {
    return input.activeRun;
  }

  const createRun = input.createRun ?? createDesktopRun;
  return createRun(input.runtimeConfig, input.deviceToken, {
    goal: input.message.trim(),
    mode: 'ai_assist',
  });
}
