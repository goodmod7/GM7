import type { RunWithSteps } from '@ai-operator/shared';
import type { DesktopApiRuntimeConfig } from './desktopRuntimeConfig.js';
import { createDesktopRun } from './desktopTasks.js';

const ACTIVE_RUN_STATUSES = new Set<RunWithSteps['status']>([
  'queued',
  'running',
  'waiting_for_user',
]);

// Marker prefix used to identify any GORKH opening goal variant (regardless of app state)
const OPENING_GOAL_MARKER = '[GORKH_OPENING]';

export const ASSISTANT_OPENING_GOAL =
  `${OPENING_GOAL_MARKER} Greet the user as GORKH. Briefly explain that you can automate tasks, explain your settings and features, and guide setup. Ask what they would like help with today, then wait for their reply before taking any action.`;

export interface AssistantTaskConfirmation {
  goal: string;
  prompt: string;
}

/**
 * Build a context-aware opening goal that tailors the greeting based on whether
 * Free AI is ready. When not ready, the assistant proactively offers to set it up.
 */
export function buildAssistantOpeningGoal(freeAiReady: boolean): string {
  if (!freeAiReady) {
    return `${OPENING_GOAL_MARKER} Greet the user as GORKH. Let them know that Free AI (the free local model) is not set up yet and offer to set it up directly from this chat using your tools. Briefly explain your key features. Ask if they would like to set up Free AI now or if you can help with something else. Wait for their reply before taking any action.`;
  }
  return ASSISTANT_OPENING_GOAL;
}

export function isAssistantOpeningGoal(goal: string | null | undefined): boolean {
  return (goal ?? '').trim().startsWith(OPENING_GOAL_MARKER);
}

export function getAssistantDisplayGoal(
  goal: string | null | undefined,
  latestUserMessage?: string | null
): string {
  if (!isAssistantOpeningGoal(goal)) {
    return goal?.trim() || 'Ready for your instructions';
  }

  const trimmedUserMessage = latestUserMessage?.trim();
  return trimmedUserMessage || 'Ready for your instructions';
}

export function shouldConfirmAssistantTaskStart(run: RunWithSteps | null | undefined): boolean {
  if (!run) {
    return true;
  }

  if (isAssistantOpeningGoal(run.goal)) {
    return true;
  }

  return !isAssistantRunActive(run);
}

export function createAssistantTaskConfirmation(message: string): AssistantTaskConfirmation {
  const goal = message.trim();
  return {
    goal,
    prompt: `I understand you want me to: ${goal}. Should I proceed?`,
  };
}

export function interpretAssistantTaskConfirmationResponse(text: string): 'confirm' | 'cancel' | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '');

  if ([
    'yes',
    'y',
    'ok',
    'okay',
    'sure',
    'confirm',
    'proceed',
    'go ahead',
  ].includes(normalized)) {
    return 'confirm';
  }

  if ([
    'no',
    'n',
    'cancel',
    'stop',
    'dont',
    "don't",
    'do not',
  ].includes(normalized)) {
    return 'cancel';
  }

  return null;
}

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
