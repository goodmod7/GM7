import { invoke } from '@tauri-apps/api/core';
import type { ToolCall, WorkspaceState as SharedWorkspaceState, ToolSummary } from '@ai-operator/shared';
import type { WsClient } from './wsClient.js';

// Re-export types
export type { ToolCall };

// Local workspace state from Rust backend
export interface LocalWorkspaceState {
  configured: boolean;
  rootName?: string;
}

interface RawWorkspaceState {
  configured: boolean;
  root_name?: string | null;
  rootName?: string | null;
}

function normalizeWorkspaceState(state: RawWorkspaceState): LocalWorkspaceState {
  return {
    configured: state.configured,
    rootName: state.rootName ?? state.root_name ?? undefined,
  };
}

// Tool execution options
export interface ToolExecuteOptions {
  wsClient: WsClient;
  deviceId: string;
  runId?: string;
}

/**
 * Configure the workspace with a directory path
 */
export async function configureWorkspace(path: string): Promise<LocalWorkspaceState> {
  const result = await invoke<{ ok: boolean; error?: string; state: RawWorkspaceState }>(
    'workspace_configure',
    { path }
  );
  
  if (!result.ok) {
    throw new Error(result.error || 'Failed to configure workspace');
  }
  
  return normalizeWorkspaceState(result.state);
}

/**
 * Get current workspace state
 */
export async function getWorkspaceState(): Promise<LocalWorkspaceState> {
  const state = await invoke<RawWorkspaceState>('workspace_get_state');
  return normalizeWorkspaceState(state);
}

/**
 * Clear workspace configuration
 */
export async function clearWorkspace(): Promise<LocalWorkspaceState> {
  const state = await invoke<RawWorkspaceState>('workspace_clear');
  return normalizeWorkspaceState(state);
}

/**
 * Execute a tool call
 */
export async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
  return await invoke<ToolResult>('tool_execute', { toolCall });
}

/**
 * Execute a tool and report to server
 */
export async function executeToolWithReporting(
  toolCall: ToolCall,
  options: ToolExecuteOptions
): Promise<{ result: ToolResult; toolEventId: string }> {
  const toolCallId = crypto.randomUUID();
  const { wsClient, runId, deviceId } = options;
  
  const pathRel = getToolPathRel(toolCall);
  const cmd = getToolCmd(toolCall);
  
  // Report request to server and get toolEventId
  let toolEventId: string;
  if (runId) {
    toolEventId = wsClient.sendToolRequest(runId, toolCallId, toolCall);
  } else {
    toolEventId = crypto.randomUUID();
  }
  
  // Execute tool
  const result = await executeTool(toolCall);
  
  // Report result to server
  if (runId && deviceId) {
    const summary: ToolSummary = {
      toolEventId,
      toolCallId,
      runId,
      deviceId,
      tool: toolCall.tool,
      pathRel,
      cmd,
      status: result.ok ? 'executed' : 'failed',
      at: Date.now(),
    };
    
    if (!result.ok && result.error) {
      summary.errorCode = result.error.code;
    }
    
    if (result.ok && result.data) {
      const data = result.data;
      switch (toolCall.tool) {
        case 'fs.list':
          // No additional metadata
          break;
        case 'fs.read_text':
          if (data.truncated !== undefined) {
            summary.truncated = data.truncated;
          }
          break;
        case 'fs.write_text':
          if (data.bytes_written !== undefined) {
            summary.bytesWritten = data.bytes_written;
          }
          break;
        case 'fs.apply_patch':
          if (data.bytes_written !== undefined) {
            summary.bytesWritten = data.bytes_written;
          }
          if (data.hunks_applied !== undefined) {
            summary.hunksApplied = data.hunks_applied;
          }
          break;
        case 'terminal.exec':
          if (data.exit_code !== undefined) {
            summary.exitCode = data.exit_code;
          }
          if (data.truncated !== undefined) {
            summary.truncated = data.truncated;
          }
          break;
      }
    }
    
    wsClient.sendToolResult(
      runId,
      toolEventId,
      toolCallId,
      toolCall,
      {
        ok: summary.status === 'executed',
        error: summary.errorCode ? { code: summary.errorCode, message: '' } : undefined,
        exitCode: summary.exitCode,
        truncated: summary.truncated,
        bytesWritten: summary.bytesWritten,
        hunksApplied: summary.hunksApplied,
      }
    );
  }
  
  return { result, toolEventId };
}

// Tool execution result
export interface ToolResult {
  ok: boolean;
  error?: {
    code: string;
    message: string;
  };
  data?: {
    // fs.list
    entries?: Array<{ name: string; kind: 'file' | 'dir'; size?: number }>;
    truncated?: boolean;
    // fs.read_text
    content?: string;
    // fs.write_text, fs.apply_patch
    bytes_written?: number;
    hunks_applied?: number;
    // terminal.exec
    exit_code?: number;
    stdout_preview?: string;
    stderr_preview?: string;
  };
}

// Helper to get pathRel for fs tools
function getToolPathRel(toolCall: ToolCall): string | undefined {
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

// Helper to get cmd for terminal tools
function getToolCmd(toolCall: ToolCall): string | undefined {
  if (toolCall.tool === 'terminal.exec') {
    return toolCall.cmd;
  }
  return undefined;
}

/**
 * Get the target (path or command) for a tool call
 */
export function getToolTarget(toolCall: ToolCall): string {
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

/**
 * Get a human-readable description of a tool call
 */
export function describeToolCall(toolCall: ToolCall): string {
  switch (toolCall.tool) {
    case 'fs.list':
      return `List directory: ${toolCall.path}`;
    case 'fs.read_text':
      return `Read file: ${toolCall.path}`;
    case 'fs.write_text':
      return `Write file: ${toolCall.path} (${toolCall.content.length} chars)`;
    case 'fs.apply_patch':
      return `Apply patch to: ${toolCall.path}`;
    case 'terminal.exec':
      return `Execute: ${toolCall.cmd} ${toolCall.args.join(' ')}`;
    default:
      return `Unknown tool: ${(toolCall as {tool: string}).tool}`;
  }
}

/**
 * Check if a tool call is potentially destructive (modifies files)
 */
export function isDestructiveTool(toolCall: ToolCall): boolean {
  return toolCall.tool === 'fs.write_text' || 
         toolCall.tool === 'fs.apply_patch' ||
         toolCall.tool === 'terminal.exec';
}

/**
 * Workspace manager class for UI integration
 */
export class WorkspaceManager {
  private wsClient: WsClient;
  private currentState: LocalWorkspaceState = { configured: false };

  constructor(wsClient: WsClient, _deviceId: string) {
    this.wsClient = wsClient;
  }

  async init(): Promise<void> {
    this.currentState = await getWorkspaceState();
    this.notifyServer();
  }

  getState(): LocalWorkspaceState {
    return { ...this.currentState };
  }

  async configure(path: string): Promise<LocalWorkspaceState> {
    this.currentState = await configureWorkspace(path);
    this.notifyServer();
    return this.currentState;
  }

  async clear(): Promise<LocalWorkspaceState> {
    this.currentState = await clearWorkspace();
    this.notifyServer();
    return this.currentState;
  }

  isConfigured(): boolean {
    return this.currentState.configured;
  }

  private notifyServer(): void {
    const sharedState: SharedWorkspaceState = {
      configured: this.currentState.configured,
      rootName: this.currentState.rootName,
    };
    this.wsClient.sendWorkspaceState(sharedState);
  }
}
