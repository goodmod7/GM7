//! Advanced Agent client library

import { invoke } from '@tauri-apps/api/core';
import { listen, type Event } from '@tauri-apps/api/event';
import type { AgentProposal } from '@ai-operator/shared';

export type ProviderType = 'native_qwen_ollama' | 'local_openai_compat' | 'openai' | 'claude';

export interface ProviderInfo {
  providerType: ProviderType;
  name: string;
  available: boolean;
  isFree: boolean;
  supportsVision: boolean;
}

export type AgentTaskStatus = 
  | { type: 'planning' }
  | { type: 'executing'; currentStep: number; totalSteps: number }
  | { type: 'awaitingApproval'; stepId: string }
  | { type: 'awaitingUserInput'; question: string }
  | { type: 'completed' }
  | { type: 'failed'; reason: string }
  | { type: 'cancelled' };

export interface AgentTask {
  taskId: string;
  goal: string;
  status: AgentTaskStatus;
  currentCost: number;
  providerUsed?: ProviderType;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  stepType: 'ui_action' | 'tool_call' | 'ask_user' | 'verification';
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
  estimatedDurationSecs: number;
  requiredApps: string[];
}

export type AgentEvent =
  | { eventType: 'task_started'; taskId: string; goal: string }
  | { eventType: 'plan_created'; taskId: string; plan: TaskPlan }
  | { eventType: 'step_started'; taskId: string; stepNumber: number; step: PlanStep }
  | { eventType: 'screen_observed'; taskId: string; observation: unknown }
  | { eventType: 'proposal_ready'; taskId: string; stepId: string; proposal: AgentProposal }
  | { eventType: 'action_proposed'; taskId: string; stepId: string; actionType: string; summary: string }
  | { eventType: 'action_approved'; taskId: string; stepId: string }
  | { eventType: 'action_denied'; taskId: string; stepId: string; reason: string }
  | { eventType: 'action_executed'; taskId: string; stepId: string; success: boolean; error?: string }
  | { eventType: 'step_completed'; taskId: string; stepId: string }
  | { eventType: 'step_failed'; taskId: string; stepId: string; error: string; willRetry: boolean }
  | { eventType: 'provider_switched'; taskId: string; from: ProviderType; to: ProviderType; reason: string }
  | { eventType: 'cost_updated'; taskId: string; totalCost: number }
  | { eventType: 'task_completed'; taskId: string; summary: string }
  | { eventType: 'task_failed'; taskId: string; reason: string };

// List available providers
export async function listProviders(): Promise<ProviderInfo[]> {
  return invoke('list_agent_providers');
}

// Test provider connection
export async function testProvider(provider: ProviderType): Promise<boolean> {
  return invoke('test_provider', { providerType: provider });
}

// Set provider API key
export async function setProviderApiKey(provider: ProviderType, apiKey: string): Promise<void> {
  return invoke('set_provider_api_key', { providerType: provider, apiKey });
}

// Check if API key exists
export async function hasProviderApiKey(provider: ProviderType): Promise<boolean> {
  return invoke('has_provider_api_key', { providerType: provider });
}

export interface StartAgentTaskOptions {
  preferredProvider?: ProviderType;
  credentialProvider?: string;
  providerBaseUrl?: string;
  providerModel?: string;
}

// Start a new agent task
export async function startAgentTask(
  goal: string,
  options?: StartAgentTaskOptions
): Promise<string> {
  return invoke('start_agent_task', {
    goal,
    preferredProvider: options?.preferredProvider,
    credentialProvider: options?.credentialProvider,
    providerBaseUrl: options?.providerBaseUrl,
    providerModel: options?.providerModel,
  });
}

// Get current task status
export async function getAgentTaskStatus(): Promise<AgentTask | null> {
  return invoke('get_agent_task_status');
}

// Cancel current task
export async function cancelAgentTask(): Promise<void> {
  return invoke('cancel_agent_task');
}

export async function approveAgentProposal(): Promise<void> {
  return invoke('approve_agent_proposal');
}

export async function denyAgentProposal(reason?: string): Promise<void> {
  return invoke('deny_agent_proposal', { reason });
}

export async function submitAgentUserResponse(response: string): Promise<void> {
  return invoke('submit_agent_user_response', { response });
}

// Subscribe to agent events
export async function onAgentEvent(
  callback: (event: AgentEvent) => void
): Promise<() => void> {
  const unlisten = await listen('agent:event', (event: Event<AgentEvent>) => {
    callback(event.payload);
  });
  return unlisten;
}

// Cost estimation for paid providers
export function estimateCost(
  provider: ProviderType | null,
  inputTokens: number,
  outputTokens: number
): number {
  if (!provider) return 0;
  
  switch (provider) {
    case 'native_qwen_ollama':
    case 'local_openai_compat':
      return 0.0;
    case 'openai':
      // GPT-4o: $5/M input, $15/M output
      return (inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 15;
    case 'claude':
      // Claude 3.5 Sonnet: $3/M input, $15/M output
      return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
    default:
      return 0.0;
  }
}

// Format cost for display
export function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost < 0.01) return '< $0.01';
  return `$${cost.toFixed(2)}`;
}
