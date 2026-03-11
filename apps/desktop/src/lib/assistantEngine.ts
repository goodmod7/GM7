import type { AgentProposal, RunConstraints } from '@ai-operator/shared';
import {
  approveAgentProposal,
  cancelAgentTask,
  denyAgentProposal,
  onAgentEvent,
  startAgentTask,
  submitAgentUserResponse,
  type ProviderType as AdvancedProviderType,
} from './advancedAgent.js';
import {
  AiAssistController,
  type AiAssistOptions,
  type AiAssistState,
  type LocalToolEvent,
} from './aiAssist.js';
import { getLlmRuntimeProvider, type LlmSettings } from './llmConfig.js';

export type AssistantEngineId = 'advanced_agent' | 'ai_assist_legacy';

export interface AssistantEngineCatalogEntry {
  id: AssistantEngineId;
  label: string;
  description: string;
  experimental: boolean;
}

export interface AssistantEngineOptions {
  wsClient: AiAssistOptions['wsClient'];
  deviceId: string;
  runId: string;
  goal: string;
  constraints: RunConstraints;
  displayId: string;
  onStateChange?: (state: AssistantEngineState) => void;
  onProposal?: (proposal: AgentProposal) => void;
  onToolEvent?: (event: LocalToolEvent) => void;
  onError?: (error: string) => void;
}

export interface AssistantEngineState extends AiAssistState {
  engineId: AssistantEngineId;
  engineLabel: string;
}

interface ExecutionResult {
  ok: boolean;
  error?: string;
}

export interface AssistantEngineHandle {
  id: AssistantEngineId;
  label: string;
  start: (settings: LlmSettings) => Promise<boolean>;
  stop: (reason?: string) => void;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
  approveAction: () => Promise<ExecutionResult>;
  approveTool: () => Promise<ExecutionResult>;
  dismissPendingProposal: (reason: string, resume?: boolean) => void;
  userResponse: (response: string) => void;
  getState: () => AssistantEngineState;
}

export const DEFAULT_ASSISTANT_ENGINE_ID: AssistantEngineId = 'advanced_agent';

const ASSISTANT_ENGINE_CATALOG: AssistantEngineCatalogEntry[] = [
  {
    id: 'advanced_agent',
    label: 'Retail Assistant Engine',
    description: 'Primary desktop assistant engine using the advanced planning, observation, approval, execution, and verification loop.',
    experimental: false,
  },
  {
    id: 'ai_assist_legacy',
    label: 'Legacy AI Assist',
    description: 'Secondary fallback engine kept for debug and migration while the retail assistant runtime settles.',
    experimental: true,
  },
];

export function getAssistantEngineCatalog(): AssistantEngineCatalogEntry[] {
  return ASSISTANT_ENGINE_CATALOG;
}

function attachEngineMeta(
  engineId: AssistantEngineId,
  engineLabel: string,
  state: AiAssistState
): AssistantEngineState {
  return {
    ...state,
    engineId,
    engineLabel,
  };
}

class LegacyAiAssistEngineAdapter implements AssistantEngineHandle {
  readonly id: AssistantEngineId = 'ai_assist_legacy';
  readonly label = 'Legacy AI Assist';

  private controller: AiAssistController;

  constructor(options: AssistantEngineOptions) {
    this.controller = new AiAssistController({
      wsClient: options.wsClient,
      deviceId: options.deviceId,
      runId: options.runId,
      goal: options.goal,
      constraints: options.constraints,
      displayId: options.displayId,
      onStateChange: (state) => {
        options.onStateChange?.(attachEngineMeta(this.id, this.label, state));
      },
      onProposal: options.onProposal,
      onToolEvent: options.onToolEvent,
      onError: options.onError,
    });
  }

  start(settings: LlmSettings): Promise<boolean> {
    return this.controller.start(settings);
  }

  stop(reason?: string): void {
    this.controller.stop(reason);
  }

  pause(): void {
    this.controller.pause();
  }

  resume(): void {
    this.controller.resume();
  }

  isPaused(): boolean {
    return this.controller.isPaused();
  }

  approveAction(): Promise<ExecutionResult> {
    return this.controller.approveAction();
  }

  approveTool(): Promise<ExecutionResult> {
    return this.controller.approveTool();
  }

  dismissPendingProposal(reason: string, resume?: boolean): void {
    this.controller.dismissPendingProposal(reason, resume);
  }

  userResponse(response: string): void {
    this.controller.userResponse(response);
  }

  getState(): AssistantEngineState {
    return attachEngineMeta(this.id, this.label, this.controller.getState());
  }
}

function mapAdvancedProvider(settings: LlmSettings): {
  provider: AdvancedProviderType;
  credentialProvider: string;
} {
  switch (settings.provider) {
    case 'native_qwen_ollama':
      return { provider: 'native_qwen_ollama', credentialProvider: 'native_qwen_ollama' };
    case 'openai_compat':
      return { provider: 'local_openai_compat', credentialProvider: 'openai_compat' };
    case 'claude':
      return { provider: 'claude', credentialProvider: 'claude' };
    default:
      if (getLlmRuntimeProvider(settings.provider) === 'openai_compat') {
        return { provider: 'openai', credentialProvider: settings.provider };
      }
      return { provider: 'openai', credentialProvider: 'openai' };
  }
}

class AdvancedAssistantEngineAdapter implements AssistantEngineHandle {
  readonly id: AssistantEngineId = 'advanced_agent';
  readonly label = 'Retail Assistant Engine';

  private state: AssistantEngineState = {
    engineId: this.id,
    engineLabel: this.label,
    isRunning: false,
    status: 'idle',
    actionCount: 0,
    logs: [],
  };

  private taskId: string | null = null;
  private unlisten: (() => void) | null = null;
  private options: AssistantEngineOptions;
  private paused = false;

  constructor(options: AssistantEngineOptions) {
    this.options = options;
  }

  private setState(nextState: Partial<AssistantEngineState>): void {
    this.state = {
      ...this.state,
      ...nextState,
      engineId: this.id,
      engineLabel: this.label,
    };
    this.options.onStateChange?.(this.state);
  }

  async start(settings: LlmSettings): Promise<boolean> {
    this.setState({
      isRunning: true,
      status: 'thinking',
      actionCount: 0,
      currentProposal: undefined,
      currentProposalId: undefined,
      lastError: undefined,
      logs: [],
    });

    const mapped = mapAdvancedProvider(settings);

    try {
      this.unlisten = await onAgentEvent((event) => {
        if (this.taskId && 'taskId' in event && event.taskId !== this.taskId) {
          return;
        }

        switch (event.eventType) {
          case 'task_started':
            this.setState({
              status: this.paused ? 'paused' : 'thinking',
            });
            break;
          case 'plan_created':
            this.setState({
              status: this.paused ? 'paused' : 'thinking',
              actionCount: event.plan.steps.length,
            });
            break;
          case 'step_started':
            this.setState({
              status: this.paused ? 'paused' : 'executing',
            });
            break;
          case 'proposal_ready':
            this.options.onProposal?.(event.proposal);
            this.setState({
              status:
                event.proposal.kind === 'ask_user'
                  ? 'asking_user'
                  : event.proposal.kind === 'done'
                    ? 'done'
                    : 'awaiting_approval',
              currentProposal: event.proposal,
              currentProposalId: event.stepId,
              lastError: undefined,
            });
            break;
          case 'action_approved':
            this.setState({
              status: this.paused ? 'paused' : 'executing',
              lastError: undefined,
            });
            break;
          case 'action_denied':
            this.setState({
              status: 'error',
              lastError: event.reason,
              currentProposal: undefined,
              currentProposalId: undefined,
            });
            break;
          case 'task_completed':
            this.setState({
              isRunning: false,
              status: 'done',
              currentProposal: {
                kind: 'done',
                summary: event.summary,
              },
              currentProposalId: undefined,
            });
            break;
          case 'task_failed':
            this.setState({
              isRunning: false,
              status: 'error',
              lastError: event.reason,
              currentProposal: undefined,
              currentProposalId: undefined,
            });
            this.options.onError?.(event.reason);
            break;
          default:
            break;
        }
      });

      this.taskId = await startAgentTask(this.options.goal, {
        preferredProvider: mapped.provider,
        credentialProvider: mapped.credentialProvider,
        providerBaseUrl: settings.baseUrl,
        providerModel: settings.model,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start the retail assistant engine';
      this.setState({
        isRunning: false,
        status: 'error',
        lastError: message,
      });
      this.options.onError?.(message);
      return false;
    }
  }

  stop(reason?: string): void {
    void cancelAgentTask().catch(() => undefined);
    this.unlisten?.();
    this.unlisten = null;
    this.taskId = null;
    this.paused = false;
    this.setState({
      isRunning: false,
      status: 'idle',
      currentProposal: undefined,
      currentProposalId: undefined,
      lastError: reason,
    });
  }

  pause(): void {
    if (!this.state.isRunning) {
      return;
    }

    this.paused = true;
    this.setState({
      status: 'paused',
    });
  }

  resume(): void {
    if (!this.state.isRunning) {
      return;
    }

    this.paused = false;
    this.setState({
      status: this.state.currentProposal?.kind === 'ask_user'
        ? 'asking_user'
        : this.state.currentProposal
          ? 'awaiting_approval'
          : 'thinking',
    });
  }

  isPaused(): boolean {
    return this.paused;
  }

  async approveAction(): Promise<ExecutionResult> {
    try {
      await approveAgentProposal();
      this.setState({
        status: this.paused ? 'paused' : 'executing',
        currentProposal: undefined,
        currentProposalId: undefined,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to approve the assistant proposal',
      };
    }
  }

  async approveTool(): Promise<ExecutionResult> {
    return this.approveAction();
  }

  dismissPendingProposal(reason: string, resume: boolean = true): void {
    void denyAgentProposal(reason).catch(() => undefined);
    this.setState({
      currentProposal: undefined,
      currentProposalId: undefined,
      status: resume ? 'thinking' : 'paused',
      lastError: reason,
    });
  }

  userResponse(response: string): void {
    void submitAgentUserResponse(response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to send your response to the assistant';
      this.options.onError?.(message);
      this.setState({
        status: 'error',
        lastError: message,
      });
    });

    this.setState({
      status: this.paused ? 'paused' : 'thinking',
      currentProposal: undefined,
      currentProposalId: undefined,
    });
  }

  getState(): AssistantEngineState {
    return this.state;
  }
}

export function createAssistantEngine(
  engineId: AssistantEngineId,
  options: AssistantEngineOptions
): AssistantEngineHandle {
  if (engineId === 'ai_assist_legacy') {
    return new LegacyAiAssistEngineAdapter(options);
  }

  return new AdvancedAssistantEngineAdapter(options);
}
