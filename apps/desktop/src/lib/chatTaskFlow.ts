import type { RunWithSteps } from '@ai-operator/shared';
import type { DesktopApiRuntimeConfig } from './desktopRuntimeConfig.js';
import { createDesktopRun } from './desktopTasks.js';
import { GORKH_FREE_AI_SETUP_COPY } from './gorkhKnowledge.js';

const ACTIVE_RUN_STATUSES = new Set<RunWithSteps['status']>([
  'queued',
  'running',
  'waiting_for_user',
]);

export interface AssistantTaskConfirmation {
  goal: string;
  summary: string;
  prompt: string;
}

export interface FreeAiSetupPreflightReport {
  title: string;
  summary: string;
  details: string;
  prompt: string;
}

export function shouldConfirmAssistantTaskStart(run: RunWithSteps | null | undefined): boolean {
  return !isAssistantRunActive(run);
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

export function interpretFreeAiSetupResponse(text: string): 'confirm' | 'cancel' | null {
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

export function buildFreeAiSetupPreflightReport(): FreeAiSetupPreflightReport {
  return {
    title: GORKH_FREE_AI_SETUP_COPY.title,
    summary: GORKH_FREE_AI_SETUP_COPY.summary,
    details: GORKH_FREE_AI_SETUP_COPY.details,
    prompt: GORKH_FREE_AI_SETUP_COPY.prompt,
  };
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
