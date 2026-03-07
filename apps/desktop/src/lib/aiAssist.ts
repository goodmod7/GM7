import { invoke } from '@tauri-apps/api/core';
import type { WsClient } from './wsClient.js';
import type { 
  AgentProposal, 
  InputAction, 
  RunConstraints, 
  LogLine,
  ToolCall,
  ToolName,
  ToolSummary,
} from '@ai-operator/shared';

export interface AiAssistOptions {
  wsClient: WsClient;
  deviceId: string;
  runId: string;
  goal: string;
  constraints: RunConstraints;
  displayId: string;
  onStateChange?: (state: AiAssistState) => void;
  onProposal?: (proposal: AgentProposal) => void;
  onToolEvent?: (event: LocalToolEvent) => void;
  onError?: (error: string) => void;
}

export interface AiAssistState {
  isRunning: boolean;
  status: 'idle' | 'capturing' | 'thinking' | 'awaiting_approval' | 'executing' | 'asking_user' | 'paused' | 'done' | 'error';
  actionCount: number;
  currentProposalId?: string;
  currentProposal?: AgentProposal;
  lastError?: string;
  logs: LogLine[];
}

export interface LlmSettings {
  provider: 'openai';
  baseUrl: string;
  model: string;
}

export interface LocalToolEvent extends ToolSummary {
  rationale?: string;
  preview?: {
    text?: string;
    stdout?: string;
    stderr?: string;
  };
}

// Tool execution result from Rust backend
type ToolResult = 
  | { ok: true; data?: unknown }
  | { ok: false; error: { code: string; message: string } };

interface ExecutionResult {
  ok: boolean;
  error?: string;
}

// Helper function to check if LLM provider is configured
export async function hasLlMProviderConfigured(provider: string): Promise<boolean> {
  try {
    return await invoke<boolean>('has_llm_api_key', { provider });
  } catch {
    return false;
  }
}

export class AiAssistController {
  private options: AiAssistOptions;
  private state: AiAssistState;
  private abortController: AbortController | null = null;
  private logs: LogLine[] = [];
  private actionResults: string[] = [];
  private activeSettings: LlmSettings | null = null;
  private paused = false;
  private statusBeforePause: AiAssistState['status'] = 'capturing';

  constructor(options: AiAssistOptions) {
    this.options = options;
    this.state = {
      isRunning: false,
      status: 'idle',
      actionCount: 0,
      logs: [],
    };
  }

  getState(): AiAssistState {
    return { ...this.state };
  }

  isPaused(): boolean {
    return this.paused;
  }

  // ============================================================================
  // Tool Execution (Iteration 7)
  // ============================================================================

  // Called when user approves a proposed tool
  async approveTool(): Promise<ExecutionResult> {
    if (this.state.status !== 'awaiting_approval' || !this.state.currentProposal) {
      console.warn('[AiAssist] Cannot approve - not awaiting approval');
      return { ok: false, error: 'Not awaiting approval' };
    }

    if (this.state.currentProposal.kind !== 'propose_tool') {
      console.warn('[AiAssist] Cannot approve - not a tool proposal');
      return { ok: false, error: 'Current proposal is not a tool request' };
    }

    this.state.status = 'executing';
    this.notifyStateChange();

    const toolCall = this.state.currentProposal.toolCall;
    const rationale = this.state.currentProposal.rationale;
    const toolCallId = crypto.randomUUID();

    // Report tool request to server (before execution) - returns toolEventId
    const toolEventId = this.options.wsClient.sendToolRequest(this.options.runId, toolCallId, toolCall);
    this.emitToolEvent({
      toolEventId,
      toolCallId,
      runId: this.options.runId,
      deviceId: this.options.deviceId,
      tool: toolCall.tool as ToolName,
      pathRel: this.getToolPathRel(toolCall),
      cmd: this.getToolCmd(toolCall),
      status: 'awaiting_user',
      at: Date.now(),
      rationale,
    });
    this.emitToolEvent({
      toolEventId,
      toolCallId,
      runId: this.options.runId,
      deviceId: this.options.deviceId,
      tool: toolCall.tool as ToolName,
      pathRel: this.getToolPathRel(toolCall),
      cmd: this.getToolCmd(toolCall),
      status: 'approved',
      at: Date.now(),
      rationale,
    });

    try {
      // Execute the tool locally
      const result = await this.executeTool(toolCall);
      
      // Create summary for server
      const summary = this.buildToolSummary(toolEventId, toolCallId, toolCall, result);
      
      // Report result to server
      this.options.wsClient.sendToolResult(
        this.options.runId,
        toolEventId,
        toolCallId,
        toolCall,
        {
          ok: result.ok,
          error: !result.ok ? result.error : undefined,
          exitCode: summary.exitCode,
          truncated: summary.truncated,
          bytesWritten: summary.bytesWritten,
          hunksApplied: summary.hunksApplied,
        }
      );
      this.emitToolEvent({
        ...summary,
        rationale,
        preview: this.buildLocalPreview(toolCall, result),
      });

      // Log result
      const target = this.getToolTarget(toolCall);
      if (result.ok) {
        this.options.wsClient.sendRunLog(
          this.options.runId,
          `Tool executed: ${toolCall.tool} ${target}`,
          'info'
        );
        this.actionResults.push(`Executed tool: ${toolCall.tool} ${target}`);
      } else {
        const errorLine = result.error.code === 'PATH_OUTSIDE_WORKSPACE'
          ? 'Blocked: path outside workspace'
          : `Tool failed: ${toolCall.tool} ${target} - ${result.error.message}`;
        this.options.wsClient.sendRunLog(
          this.options.runId,
          errorLine,
          'warn'
        );
        this.actionResults.push(errorLine);
      }

      // Increment action count
      this.state.actionCount++;
      
      // Check constraints
      if (this.state.actionCount >= this.options.constraints.maxActions) {
        this.log('warn', `Reached max actions limit (${this.options.constraints.maxActions})`);
        this.options.wsClient.sendRunLog(
          this.options.runId,
          `Reached maximum action limit (${this.options.constraints.maxActions})`,
          'warn'
        );
        
        this.state.currentProposal = {
          kind: 'ask_user',
          question: `I've reached the maximum action limit (${this.options.constraints.maxActions}). Would you like me to continue with additional actions or mark the task as complete?`,
        };
        this.state.status = 'asking_user';
        this.options.onProposal?.(this.state.currentProposal);
        this.notifyStateChange();
        return { ok: true };
      }

      // Continue to next iteration
      this.state.status = 'capturing';
      this.state.currentProposal = undefined;
      this.state.currentProposalId = undefined;
      this.notifyStateChange();
      this.resumeLoop();
      return { ok: true };
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Tool execution failed';
      console.error('[AiAssist] Tool execution failed:', errorMsg);
      
      // Report error result to server
      this.options.wsClient.sendToolResult(
        this.options.runId,
        toolEventId,
        toolCallId,
        toolCall,
        {
          ok: false,
          error: { code: 'EXECUTION_FAILED', message: errorMsg },
        }
      );
      this.emitToolEvent({
        toolEventId,
        toolCallId,
        runId: this.options.runId,
        deviceId: this.options.deviceId,
        tool: toolCall.tool as ToolName,
        pathRel: this.getToolPathRel(toolCall),
        cmd: this.getToolCmd(toolCall),
        status: 'failed',
        at: Date.now(),
        errorCode: 'EXECUTION_FAILED',
        rationale,
      });
      this.options.wsClient.sendRunLog(
        this.options.runId,
        `Tool execution error: ${errorMsg}`,
        'error'
      );

      // Ask user what to do
      this.state.currentProposal = {
        kind: 'ask_user',
        question: `The tool execution failed: ${errorMsg}. Would you like me to try a different approach or stop?`,
      };
      this.state.status = 'asking_user';
      this.options.onProposal?.(this.state.currentProposal);
      this.notifyStateChange();
      return { ok: false, error: errorMsg };
    }
  }

  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    return await invoke<ToolResult>('tool_execute', { toolCall });
  }

  private getToolTarget(toolCall: ToolCall): string {
    switch (toolCall.tool) {
      case 'fs.list':
      case 'fs.read_text':
      case 'fs.write_text':
      case 'fs.apply_patch':
        return toolCall.path;
      case 'terminal.exec':
        return toolCall.cmd;
      default:
        return '';
    }
  }

  private getToolPathRel(toolCall: ToolCall): string | undefined {
    switch (toolCall.tool) {
      case 'fs.list':
      case 'fs.read_text':
      case 'fs.write_text':
      case 'fs.apply_patch':
        return toolCall.path;
      default:
        return undefined;
    }
  }

  private getToolCmd(toolCall: ToolCall): string | undefined {
    if (toolCall.tool === 'terminal.exec') {
      return toolCall.cmd;
    }
    return undefined;
  }

  private buildToolSummary(
    toolEventId: string,
    toolCallId: string,
    toolCall: ToolCall,
    result: ToolResult
  ): ToolSummary {
    const summary: ToolSummary = {
      toolEventId,
      toolCallId,
      runId: this.options.runId,
      deviceId: this.options.deviceId,
      tool: toolCall.tool as ToolName,
      pathRel: this.getToolPathRel(toolCall),
      cmd: this.getToolCmd(toolCall),
      status: result.ok ? 'executed' : 'failed',
      at: Date.now(),
    };

    // Add metadata based on tool type and result
    if (result.ok) {
      const data = result.data as {
        truncated?: boolean;
        bytes_written?: number;
        hunks_applied?: number;
        exit_code?: number;
      } | undefined;

      switch (toolCall.tool) {
        case 'fs.list':
          // No additional properties needed for list
          break;
        case 'fs.read_text':
          summary.truncated = data?.truncated ?? false;
          break;
        case 'fs.write_text':
          summary.bytesWritten = data?.bytes_written ?? 0;
          break;
        case 'fs.apply_patch':
          summary.bytesWritten = data?.bytes_written ?? 0;
          summary.hunksApplied = data?.hunks_applied ?? 0;
          break;
        case 'terminal.exec':
          summary.exitCode = data?.exit_code ?? -1;
          summary.truncated = data?.truncated ?? false;
          break;
      }
    } else {
      summary.errorCode = result.error.code;
    }

    return summary;
  }

  async start(settings: LlmSettings): Promise<boolean> {
    if (this.state.isRunning) {
      console.log('[AiAssist] Already running');
      return true;
    }

    // Check if API key is configured
    const hasKey = await hasLlMProviderConfigured(settings.provider);
    if (!hasKey) {
      this.setError('LLM API key not configured. Please set it in Settings.');
      this.options.wsClient.sendRunLog(
        this.options.runId,
        'AI Assist cannot start: LLM API key not configured',
        'error'
      );
      this.options.wsClient.sendRunUpdate(
        this.options.runId,
        'failed',
        'LLM_NOT_CONFIGURED'
      );
      return false;
    }

    this.abortController = new AbortController();
    this.activeSettings = settings;
    this.paused = false;
    this.state = {
      ...this.state,
      isRunning: true,
      status: 'capturing',
      actionCount: 0,
      logs: [],
    };
    this.notifyStateChange();

    this.log('info', 'AI Assist started');
    this.options.wsClient.sendRunLog(this.options.runId, 'AI Assist mode started', 'info');

    // Start the main loop
    this.resumeLoop();

    return true;
  }

  stop(reason: string = 'User stopped'): void {
    if (!this.state.isRunning) return;

    console.log('[AiAssist] Stopping:', reason);
    this.abortController?.abort();
    this.activeSettings = null;
    this.paused = false;
    
    this.state.isRunning = false;
    this.state.status = 'idle';
    this.state.currentProposal = undefined;
    this.state.currentProposalId = undefined;
    this.notifyStateChange();

    this.log('info', `AI Assist stopped: ${reason}`);
    this.options.wsClient.sendRunLog(this.options.runId, `AI Assist stopped: ${reason}`, 'info');
  }

  pause(): void {
    if (!this.state.isRunning || this.paused) {
      return;
    }

    this.paused = true;
    this.statusBeforePause = this.state.status;
    this.state.status = 'paused';
    this.notifyStateChange();
    this.options.wsClient.sendRunLog(this.options.runId, 'Paused by user', 'info');
  }

  resume(): void {
    if (!this.state.isRunning || !this.paused) {
      return;
    }

    this.paused = false;
    this.state.status = this.statusBeforePause;
    this.notifyStateChange();
    this.options.wsClient.sendRunLog(this.options.runId, 'Resumed by user', 'info');

    if (this.state.status === 'capturing' || this.state.status === 'thinking') {
      this.resumeLoop();
    }
  }

  // Called when user approves a proposed action
  async approveAction(): Promise<ExecutionResult> {
    if (this.state.status !== 'awaiting_approval' || !this.state.currentProposal) {
      console.warn('[AiAssist] Cannot approve - not awaiting approval');
      return { ok: false, error: 'Not awaiting approval' };
    }

    if (this.state.currentProposal.kind !== 'propose_action') {
      console.warn('[AiAssist] Cannot approve - not an action proposal');
      return { ok: false, error: 'Current proposal is not an action request' };
    }

    this.state.status = 'executing';
    this.notifyStateChange();

    const action = this.state.currentProposal.action;
    const actionId = crypto.randomUUID();
    const createdAt = Date.now();

    // Report action creation to server
    this.options.wsClient.sendActionCreate(actionId, action, createdAt, this.options.runId);

    try {
      // Execute the action locally
      await this.executeAction(action);
      
      // Report success
      this.options.wsClient.sendActionResult(actionId, true);
      this.options.wsClient.sendRunLog(
        this.options.runId,
        `Action executed: ${this.summarizeAction(action)}`,
        'info'
      );

      // Track action result for history
      this.actionResults.push(`Executed: ${this.summarizeAction(action)}`);

      // Increment action count
      this.state.actionCount++;
      
      // Check constraints
      if (this.state.actionCount >= this.options.constraints.maxActions) {
        this.log('warn', `Reached max actions limit (${this.options.constraints.maxActions})`);
        this.options.wsClient.sendRunLog(
          this.options.runId,
          `Reached maximum action limit (${this.options.constraints.maxActions})`,
          'warn'
        );
        
        // Ask user if they want to continue
        this.state.currentProposal = {
          kind: 'ask_user',
          question: `I've reached the maximum action limit (${this.options.constraints.maxActions}). Would you like me to continue with additional actions or mark the task as complete?`,
        };
        this.state.status = 'asking_user';
        this.options.onProposal?.(this.state.currentProposal);
        this.notifyStateChange();
        return { ok: true };
      }

      // Continue to next iteration
      this.state.status = 'capturing';
      this.state.currentProposal = undefined;
      this.state.currentProposalId = undefined;
      this.notifyStateChange();
      this.resumeLoop();
      return { ok: true };
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Execution failed';
      console.error('[AiAssist] Action execution failed:', errorMsg);
      
      this.options.wsClient.sendActionResult(actionId, false, {
        code: 'EXECUTION_FAILED',
        message: errorMsg,
      });
      this.options.wsClient.sendRunLog(
        this.options.runId,
        `Action failed: ${errorMsg}`,
        'error'
      );

      // Ask user what to do
      this.state.currentProposal = {
        kind: 'ask_user',
        question: `The action failed: ${errorMsg}. Would you like me to try a different approach or stop?`,
      };
      this.state.status = 'asking_user';
      this.options.onProposal?.(this.state.currentProposal);
      this.notifyStateChange();
      return { ok: false, error: errorMsg };
    }
  }

  // Called when user rejects a proposed action
  rejectAction(): void {
    this.dismissPendingProposal('User rejected action proposal');
  }

  rejectTool(): void {
    this.dismissPendingProposal('User rejected tool proposal');
  }

  dismissPendingProposal(reason: string, resume: boolean = true): void {
    const isProposalPending =
      this.state.currentProposal?.kind === 'propose_action' || this.state.currentProposal?.kind === 'propose_tool';

    if (!isProposalPending) {
      return;
    }

    this.log('info', reason);
    this.options.wsClient.sendRunLog(this.options.runId, reason, 'info');
    this.actionResults.push(reason);

    this.state.currentProposal = undefined;
    this.state.currentProposalId = undefined;

    if (!resume) {
      if (this.paused) {
        this.state.status = 'paused';
      }
      this.notifyStateChange();
      return;
    }

    this.state.status = 'capturing';
    this.notifyStateChange();
    this.resumeLoop();
  }

  // Called when user responds to an ask_user question
  userResponse(response: string): void {
    if (this.state.status !== 'asking_user') return;

    this.log('info', `User response: ${response}`);
    this.options.wsClient.sendRunLog(this.options.runId, `User: ${response}`, 'info');

    // Check if user wants to stop
    const lower = response.toLowerCase();
    if (lower.includes('stop') || lower.includes('quit') || lower.includes('done') || lower.includes('finish')) {
      this.state.status = 'done';
      this.state.isRunning = false;
      this.notifyStateChange();
      
      this.options.wsClient.sendRunUpdate(this.options.runId, 'done', 'User requested completion');
      this.options.wsClient.sendRunLog(this.options.runId, 'Task completed by user request', 'info');
      return;
    }

    // Continue with user feedback
    this.actionResults.push(`User said: ${response}`);
    this.state.status = 'capturing';
    this.state.currentProposal = undefined;
    this.state.currentProposalId = undefined;
    this.notifyStateChange();
    this.resumeLoop();
  }

  private resumeLoop(): void {
    if (!this.state.isRunning || this.paused || !this.activeSettings) {
      return;
    }

    this.runLoop(this.activeSettings).catch((err) => {
      console.error('[AiAssist] Loop error:', err);
      this.setError(err instanceof Error ? err.message : 'Unknown error');
    });
  }

  private async runLoop(settings: LlmSettings): Promise<void> {
    while (this.state.isRunning && !this.abortController?.signal.aborted) {
      try {
        if (this.paused) {
          return;
        }

        // Capture screenshot
        this.state.status = 'capturing';
        this.notifyStateChange();

        const screenshot = await this.captureScreenshot();

        if (this.paused) {
          return;
        }

        // Get proposal from LLM
        this.state.status = 'thinking';
        this.notifyStateChange();

        const proposal = await this.getLlmProposal(settings, screenshot);
        this.state.currentProposal = proposal;
        this.state.currentProposalId = crypto.randomUUID();

        // Handle different proposal types
        switch (proposal.kind) {
          case 'done': {
            this.state.status = 'done';
            this.state.isRunning = false;
            this.notifyStateChange();
            
            this.log('info', `Task complete: ${proposal.summary}`);
            this.options.wsClient.sendAgentProposal(this.options.runId, proposal);
            this.options.wsClient.sendRunLog(this.options.runId, `Task complete: ${proposal.summary}`, 'info');
            this.options.wsClient.sendRunUpdate(this.options.runId, 'done');
            this.options.wsClient.sendChat(`Task completed: ${proposal.summary}`, this.options.runId);
            return;
          }

          case 'ask_user': {
            this.state.status = 'asking_user';
            this.notifyStateChange();
            
            this.log('info', `Asking user: ${proposal.question}`);
            this.options.wsClient.sendAgentProposal(this.options.runId, proposal);
            this.options.wsClient.sendRunLog(this.options.runId, `Question: ${proposal.question}`, 'info');
            this.options.onProposal?.(proposal);
            
            // Wait for user response (handled by userResponse method)
            return;
          }

          case 'propose_action': {
            this.state.status = 'awaiting_approval';
            this.notifyStateChange();
            
            this.log('info', `Proposed action: ${this.summarizeAction(proposal.action)}`);
            this.options.wsClient.sendAgentProposal(this.options.runId, proposal);
            this.options.onProposal?.(proposal);
            
            // Wait for user approval (handled by approveAction/rejectAction methods)
            return;
          }

          case 'propose_tool': {
            this.state.status = 'awaiting_approval';
            this.notifyStateChange();
            
            const toolName = proposal.toolCall.tool;
            const target = this.getToolTarget(proposal.toolCall);
            this.log('info', `Proposed tool: ${toolName} ${target}`);
            this.options.wsClient.sendAgentProposal(this.options.runId, proposal);
            this.options.onProposal?.(proposal);
            
            // Wait for user approval (handled by approveTool/rejectAction methods)
            return;
          }
        }
      } catch (err) {
        if (this.abortController?.signal.aborted) return;
        
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[AiAssist] Loop error:', err);
        this.setError(errorMsg);
        
        // Ask user what to do
        this.state.currentProposal = {
          kind: 'ask_user',
          question: `An error occurred: ${errorMsg}. Would you like me to try again or stop?`,
        };
        this.state.status = 'asking_user';
        this.options.onProposal?.(this.state.currentProposal);
        this.notifyStateChange();
        return;
      }
    }
  }

  private async captureScreenshot(): Promise<string | null> {
    try {
      const result = await invoke<{ png_base64: string; width: number; height: number; byte_length: number }>(
        'capture_display_png',
        {
          displayId: this.options.displayId,
          maxWidth: 1280,
        }
      );
      return result.png_base64;
    } catch (e) {
      console.warn('[AiAssist] Screenshot failed:', e);
      return null;
    }
  }

  private async getLlmProposal(settings: LlmSettings, screenshot: string | null): Promise<AgentProposal> {
    const result = await invoke<{ proposal: AgentProposal }>('llm_propose_next_action', {
      params: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        goal: this.options.goal,
        screenshotPngBase64: screenshot,
        history: {
          lastActions: this.actionResults.slice(-5),
        },
        constraints: {
          maxActions: this.options.constraints.maxActions,
          maxRuntimeMinutes: this.options.constraints.maxRuntimeMinutes,
        },
      },
    });

    return result.proposal;
  }

  private async executeAction(action: InputAction): Promise<void> {
    switch (action.kind) {
      case 'click':
        await invoke('input_click', {
          xNorm: action.x,
          yNorm: action.y,
          button: action.button,
        });
        break;

      case 'double_click':
        await invoke('input_double_click', {
          xNorm: action.x,
          yNorm: action.y,
          button: action.button,
        });
        break;

      case 'scroll':
        await invoke('input_scroll', {
          dx: action.dx,
          dy: action.dy,
        });
        break;

      case 'type':
        await invoke('input_type', {
          text: action.text,
        });
        break;

      case 'hotkey':
        await invoke('input_hotkey', {
          key: action.key,
          modifiers: action.modifiers || [],
        });
        break;

      default:
        throw new Error(`Unknown action kind: ${(action as {kind: string}).kind}`);
    }

    // Small delay after action
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private summarizeAction(action: InputAction): string {
    switch (action.kind) {
      case 'type':
        return `type (${action.text.length} chars)`;
      case 'click':
        return `click at (${action.x.toFixed(2)}, ${action.y.toFixed(2)})`;
      case 'double_click':
        return `double-click at (${action.x.toFixed(2)}, ${action.y.toFixed(2)})`;
      case 'scroll':
        return `scroll (${action.dx}, ${action.dy})`;
      case 'hotkey':
        return `hotkey ${action.key}${action.modifiers?.length ? ' + ' + action.modifiers.join(',') : ''}`;
      default:
        return 'unknown action';
    }
  }

  private log(level: 'info' | 'warn' | 'error', line: string): void {
    const logLine: LogLine = { line, level, at: Date.now() };
    this.logs.push(logLine);
    if (this.logs.length > 1000) {
      this.logs.shift();
    }
    this.state.logs = [...this.logs];
  }

  private setError(message: string): void {
    this.state.lastError = message;
    this.state.status = 'error';
    this.state.currentProposal = undefined;
    this.state.currentProposalId = undefined;
    this.paused = false;
    this.notifyStateChange();
    this.options.onError?.(message);
  }

  private notifyStateChange(): void {
    this.options.onStateChange?.({ ...this.state });
  }

  private emitToolEvent(event: LocalToolEvent): void {
    this.options.onToolEvent?.({
      ...event,
      preview: event.preview ? { ...event.preview } : undefined,
    });
  }

  private buildLocalPreview(toolCall: ToolCall, result: ToolResult): LocalToolEvent['preview'] {
    if (!result.ok || !result.data || typeof result.data !== 'object' || result.data === null) {
      return undefined;
    }

    if (toolCall.tool === 'fs.read_text' && 'content' in result.data) {
      const data = result.data as { content: string };
      return { text: data.content.slice(0, 4000) };
    }

    if (toolCall.tool === 'terminal.exec' && 'stdout_preview' in result.data) {
      const data = result.data as { stdout_preview: string; stderr_preview: string };
      return {
        stdout: data.stdout_preview,
        stderr: data.stderr_preview,
      };
    }

    return undefined;
  }
}
