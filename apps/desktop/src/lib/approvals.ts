import type { AgentProposal, InputAction, ToolCall } from '@ai-operator/shared';

export type ApprovalKind = 'control_action' | 'tool_call' | 'ai_proposal';
export type ApprovalState =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'canceled'
  | 'executing'
  | 'executed'
  | 'failed';
export type ApprovalRisk = 'low' | 'medium' | 'high';
export type ApprovalSource = 'web' | 'agent';
export type PermissionStatusValue = 'granted' | 'denied' | 'unknown';

export interface ApprovalItem {
  id: string;
  kind: ApprovalKind;
  createdAt: number;
  expiresAt: number;
  summary: string;
  risk: ApprovalRisk;
  runId?: string;
  actionId?: string;
  toolId?: string;
  source: ApprovalSource;
  state: ApprovalState;
  error?: string;
}

export interface ApprovalCreateInput {
  kind: ApprovalKind;
  createdAt: number;
  expiresAt: number;
  summary: string;
  risk: ApprovalRisk;
  runId?: string;
  actionId?: string;
  toolId?: string;
  source: ApprovalSource;
  error?: string;
}

export interface ApprovalChangeEvent {
  type: 'created' | 'updated';
  item: ApprovalItem;
  previousState?: ApprovalState;
}

interface ApprovalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ApprovalControllerOptions {
  autoStart?: boolean;
  intervalMs?: number;
  maxHistory?: number;
  maxPersisted?: number;
  now?: () => number;
  storageKey?: string;
  storage?: ApprovalStorageLike | null;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

type ApprovalListener = (items: ApprovalItem[], event?: ApprovalChangeEvent) => void;

const STORAGE_KEY = 'ai-operator-approval-history';
const DEFAULT_TIMEOUT_MS = 60_000;

function createApprovalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `approval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDefaultStorage(): ApprovalStorageLike | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage;
}

function isTerminalState(state: ApprovalState): boolean {
  return ['denied', 'expired', 'canceled', 'executed', 'failed'].includes(state);
}

export function summarizeInputAction(action: InputAction): string {
  switch (action.kind) {
    case 'type':
      return `Type (${action.text.length} chars)`;
    case 'click':
      return `Click ${action.button} at ${(action.x * 100).toFixed(0)}%, ${(action.y * 100).toFixed(0)}%`;
    case 'double_click':
      return `Double click ${action.button} at ${(action.x * 100).toFixed(0)}%, ${(action.y * 100).toFixed(0)}%`;
    case 'scroll':
      return `Scroll dx=${action.dx} dy=${action.dy}`;
    case 'hotkey':
      return `Hotkey ${action.key}${action.modifiers?.length ? ` + ${action.modifiers.join('+')}` : ''}`;
    default:
      return 'Input action';
  }
}

export function summarizeToolCall(toolCall: ToolCall): string {
  switch (toolCall.tool) {
    case 'fs.list':
      return `fs.list path=${toolCall.path}`;
    case 'fs.read_text':
      return `fs.read_text path=${toolCall.path}`;
    case 'fs.write_text':
      return `fs.write_text path=${toolCall.path}`;
    case 'fs.apply_patch':
      return `fs.apply_patch path=${toolCall.path}`;
    case 'terminal.exec':
      return `terminal.exec cmd=${toolCall.cmd}`;
    default:
      return 'tool_call';
  }
}

export function summarizeAgentProposal(proposal: AgentProposal): string {
  switch (proposal.kind) {
    case 'propose_action':
      return `AI proposal: ${summarizeInputAction(proposal.action)}`;
    case 'propose_tool':
      return `AI proposal: ${summarizeToolCall(proposal.toolCall)}`;
    case 'ask_user':
      return 'AI proposal: ask_user';
    case 'done':
      return 'AI proposal: done';
    default:
      return 'AI proposal';
  }
}

export function getApprovalRiskForAction(action: InputAction): ApprovalRisk {
  switch (action.kind) {
    case 'click':
    case 'double_click':
    case 'scroll':
      return 'low';
    case 'hotkey':
    case 'type':
      return 'medium';
    default:
      return 'medium';
  }
}

export function getApprovalRiskForTool(toolCall: ToolCall): ApprovalRisk {
  switch (toolCall.tool) {
    case 'fs.list':
    case 'fs.read_text':
      return 'low';
    case 'fs.write_text':
    case 'fs.apply_patch':
    case 'terminal.exec':
      return 'high';
    default:
      return 'medium';
  }
}

export function getApprovalRiskForProposal(proposal: AgentProposal): ApprovalRisk {
  switch (proposal.kind) {
    case 'propose_action':
      return getApprovalRiskForAction(proposal.action);
    case 'propose_tool':
      return getApprovalRiskForTool(proposal.toolCall);
    default:
      return 'medium';
  }
}

function sanitizePersistedItem(item: ApprovalItem): ApprovalItem {
  return {
    id: item.id,
    kind: item.kind,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    summary: item.summary,
    risk: item.risk,
    runId: item.runId,
    actionId: item.actionId,
    toolId: item.toolId,
    source: item.source,
    state: item.state,
    error: item.error,
  };
}

function hydrateApprovalItems(storage: ApprovalStorageLike | null, storageKey: string): ApprovalItem[] {
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ApprovalItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function transitionApprovalState(item: ApprovalItem, nextState: ApprovalState, error?: string): ApprovalItem {
  if (item.state === nextState) {
    return item;
  }

  if (isTerminalState(item.state)) {
    return item;
  }

  const allowedTransitions: Record<ApprovalState, ApprovalState[]> = {
    pending: ['approved', 'denied', 'expired', 'canceled'],
    approved: ['executing', 'failed', 'canceled'],
    denied: [],
    expired: [],
    canceled: [],
    executing: ['executed', 'failed', 'canceled'],
    executed: [],
    failed: [],
  };

  if (!allowedTransitions[item.state].includes(nextState)) {
    return item;
  }

  return {
    ...item,
    state: nextState,
    error,
  };
}

export function createApprovalController(options: ApprovalControllerOptions = {}) {
  const listeners = new Set<ApprovalListener>();
  const storageKey = options.storageKey || STORAGE_KEY;
  const storage = options.storage ?? getDefaultStorage();
  const now = options.now ?? (() => Date.now());
  const maxHistory = options.maxHistory ?? 200;
  const maxPersisted = options.maxPersisted ?? 50;
  const intervalMs = options.intervalMs ?? 1_000;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  let items = hydrateApprovalItems(storage, storageKey).slice(0, maxHistory);
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  function persist(): void {
    if (!storage) {
      return;
    }
    storage.setItem(
      storageKey,
      JSON.stringify(items.slice(0, maxPersisted).map(sanitizePersistedItem))
    );
  }

  function notify(event?: ApprovalChangeEvent): void {
    const snapshot = items.map((item) => ({ ...item }));
    persist();
    for (const listener of listeners) {
      listener(snapshot, event);
    }
  }

  function replaceItem(nextItem: ApprovalItem, event: ApprovalChangeEvent): ApprovalItem {
    items = items.map((item) => (item.id === nextItem.id ? nextItem : item)).slice(0, maxHistory);
    notify(event);
    return nextItem;
  }

  function createApproval(input: ApprovalCreateInput): string {
    const approval: ApprovalItem = {
      ...input,
      id: createApprovalId(),
      state: 'pending',
    };
    items = [approval, ...items].slice(0, maxHistory);
    notify({
      type: 'created',
      item: approval,
    });
    return approval.id;
  }

  function updateState(id: string, nextState: ApprovalState, error?: string): ApprovalItem | undefined {
    const currentItem = items.find((item) => item.id === id);
    if (!currentItem) {
      return undefined;
    }
    const nextItem = transitionApprovalState(currentItem, nextState, error);
    if (nextItem === currentItem) {
      return currentItem;
    }
    return replaceItem(nextItem, {
      type: 'updated',
      item: nextItem,
      previousState: currentItem.state,
    });
  }

  function approve(id: string): ApprovalItem | undefined {
    return updateState(id, 'approved');
  }

  function deny(id: string, reason?: string): ApprovalItem | undefined {
    return updateState(id, 'denied', reason);
  }

  function cancel(id: string, reason?: string): ApprovalItem | undefined {
    return updateState(id, 'canceled', reason);
  }

  function markExecuting(id: string): ApprovalItem | undefined {
    return updateState(id, 'executing');
  }

  function markExecuted(id: string): ApprovalItem | undefined {
    return updateState(id, 'executed');
  }

  function markFailed(id: string, error?: string): ApprovalItem | undefined {
    return updateState(id, 'failed', error);
  }

  function expireDueApprovals(currentTime: number = now()): ApprovalItem[] {
    const expiredItems: ApprovalItem[] = [];
    for (const item of items) {
      if (item.state !== 'pending' || item.expiresAt > currentTime) {
        continue;
      }
      const nextItem = transitionApprovalState(item, 'expired', 'Approval timed out');
      if (nextItem !== item) {
        items = items.map((candidate) => (candidate.id === nextItem.id ? nextItem : candidate));
        expiredItems.push(nextItem);
        notify({
          type: 'updated',
          item: nextItem,
          previousState: item.state,
        });
      }
    }
    return expiredItems;
  }

  function cancelAllPending(reason: string, filter?: (item: ApprovalItem) => boolean): ApprovalItem[] {
    const canceled: ApprovalItem[] = [];
    for (const item of items) {
      if (item.state !== 'pending') {
        continue;
      }
      if (filter && !filter(item)) {
        continue;
      }
      const nextItem = transitionApprovalState(item, 'canceled', reason);
      if (nextItem !== item) {
        items = items.map((candidate) => (candidate.id === nextItem.id ? nextItem : candidate));
        canceled.push(nextItem);
        notify({
          type: 'updated',
          item: nextItem,
          previousState: item.state,
        });
      }
    }
    return canceled;
  }

  function subscribe(listener: ApprovalListener): () => void {
    listeners.add(listener);
    listener(items.map((item) => ({ ...item })));
    return () => {
      listeners.delete(listener);
    };
  }

  function getItems(): ApprovalItem[] {
    return items.map((item) => ({ ...item }));
  }

  function getItem(id: string): ApprovalItem | undefined {
    return items.find((item) => item.id === id);
  }

  function exportDiagnostics(permissionStatus: {
    screenRecording: PermissionStatusValue;
    accessibility: PermissionStatusValue;
  }): string {
    return JSON.stringify(
      {
        exportedAt: now(),
        permissions: permissionStatus,
        approvals: items.slice(0, maxPersisted).map(sanitizePersistedItem),
      },
      null,
      2
    );
  }

  function start(): void {
    if (intervalHandle || options.autoStart === false || typeof setIntervalFn !== 'function') {
      return;
    }
    intervalHandle = setIntervalFn(() => {
      expireDueApprovals(now());
    }, intervalMs);
  }

  function destroy(): void {
    if (!intervalHandle) {
      return;
    }
    clearIntervalFn(intervalHandle);
    intervalHandle = null;
  }

  if (options.autoStart !== false && typeof window !== 'undefined') {
    start();
  }

  return {
    createApproval,
    approve,
    deny,
    cancel,
    cancelAllPending,
    expireDueApprovals,
    markExecuting,
    markExecuted,
    markFailed,
    subscribe,
    getItems,
    getItem,
    exportDiagnostics,
    start,
    destroy,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export const approvalController = createApprovalController();
export const APPROVAL_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
