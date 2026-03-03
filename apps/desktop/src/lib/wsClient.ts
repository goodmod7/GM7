import {
  type DeviceMessage,
  type ServerMessage,
  parseServerMessage,
  createDeviceMessage,
  PROTOCOL_VERSION,
  type ErrorCode,
  type ServerRunDetails,
  type ServerRunStepUpdate,
  type ServerRunLog,
  type ServerApprovalRequest,
  type ServerRunCanceled,
  type ServerActionRequest,
  type ServerDeviceToken,
  type RunWithSteps,
  type RunStep,
  type LogLine,
  type ApprovalRequest,
  type InputAction,
  type AgentProposal,
  type ToolCall,
  type WorkspaceState,
} from '@ai-operator/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WsClientOptions {
  deviceId: string;
  deviceName?: string;
  platform: 'macos' | 'windows' | 'linux' | 'unknown';
  appVersion?: string;
  deviceToken?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onMessage?: (message: ServerMessage) => void;
  onError?: (error: { code: ErrorCode; message: string }) => void;
  onRunDetails?: (run: RunWithSteps) => void;
  onStepUpdate?: (runId: string, step: RunStep) => void;
  onRunLog?: (runId: string, stepId: string | undefined, log: LogLine) => void;
  onApprovalRequest?: (runId: string, approval: ApprovalRequest) => void;
  onRunCanceled?: (runId: string) => void;
  onDeviceToken?: (deviceToken: string) => void;
  onActionRequest?: (actionId: string, action: InputAction) => void;
  onAgentProposal?: (runId: string, proposal: AgentProposal) => void;
  onRunStart?: (runId: string, goal: string, mode?: 'manual' | 'ai_assist') => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 10000;
  private helloTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingIntervalMs = 30000;

  constructor(private options: WsClientOptions) {}

  getDeviceId(): string { return this.options.deviceId; }
  getStatus(): ConnectionStatus { return this.status; }
  setDeviceToken(deviceToken: string): void { this.options.deviceToken = deviceToken; }
  setPingIntervalMs(intervalMs: number): void {
    this.pingIntervalMs = intervalMs;
    if (this.status === 'connected') {
      this.startPingInterval();
    }
  }

  connect(url: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.sendHello();
        this.helloTimeout = setTimeout(() => {
          this.ws?.close();
          this.setStatus('error');
        }, 10000);
      };
      this.ws.onmessage = (event) => {
        try { this.handleMessage(JSON.parse(event.data as string)); }
        catch (err) { console.error('[WsClient] Parse error:', err); }
      };
      this.ws.onclose = () => { this.cleanup(); this.setStatus('disconnected'); this.scheduleReconnect(url); };
      this.ws.onerror = () => { this.setStatus('error'); };
    } catch (err) { this.setStatus('error'); this.scheduleReconnect(url); }
  }

  disconnect(): void { this.cleanup(); this.ws?.close(); this.ws = null; this.setStatus('disconnected'); }

  send(message: DeviceMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try { this.ws.send(JSON.stringify(message)); return true; }
    catch { return false; }
  }

  sendPing(): boolean { return this.send(createDeviceMessage('device.ping', { deviceId: this.options.deviceId })); }
  requestPairingCode(): boolean { return this.send(createDeviceMessage('device.pairing.request_code', { deviceId: this.options.deviceId })); }
  sendChat(text: string, runId?: string): boolean { return this.send(createDeviceMessage('device.chat.send', { deviceId: this.options.deviceId, runId, message: { role: 'user', text, createdAt: Date.now() } })); }
  sendRunAccept(runId: string): boolean { return this.send(createDeviceMessage('device.run.accept', { deviceId: this.options.deviceId, runId })); }
  sendApprovalDecision(runId: string, approvalId: string, decision: 'approved' | 'denied', comment?: string): boolean { return this.send(createDeviceMessage('device.approval.decision', { deviceId: this.options.deviceId, runId, approvalId, decision, comment })); }
  sendRunCancel(runId: string): boolean { return this.send(createDeviceMessage('device.run.cancel', { deviceId: this.options.deviceId, runId })); }
  sendControlState(enabled: boolean, requestedBy?: 'local_user' | 'web'): boolean { return this.send(createDeviceMessage('device.control.state', { deviceId: this.options.deviceId, state: { enabled, requestedBy, updatedAt: Date.now() } })); }
  sendActionAck(actionId: string, status: 'awaiting_user' | 'approved' | 'denied'): boolean { return this.send(createDeviceMessage('device.action.ack', { deviceId: this.options.deviceId, actionId, status })); }
  sendActionResult(actionId: string, ok: boolean, error?: { code: string; message: string }): boolean { return this.send(createDeviceMessage('device.action.result', { deviceId: this.options.deviceId, actionId, ok, error })); }
  sendRunStepUpdate(runId: string, step: RunStep): boolean { return this.send(createDeviceMessage('device.run.step_update', { deviceId: this.options.deviceId, runId, step })); }
  sendRunLog(runId: string, line: string, level: 'info' | 'warn' | 'error' = 'info', stepId?: string): boolean { return this.send(createDeviceMessage('device.run.log', { deviceId: this.options.deviceId, runId, stepId, line, level, at: Date.now() })); }
  sendAgentProposal(runId: string, proposal: AgentProposal): boolean { return this.send(createDeviceMessage('device.agent.proposal', { deviceId: this.options.deviceId, runId, proposal })); }
  sendActionCreate(actionId: string, action: InputAction, createdAt: number, runId?: string): boolean { return this.send(createDeviceMessage('device.action.create', { deviceId: this.options.deviceId, actionId, runId, action, source: 'agent', createdAt })); }
  sendRunUpdate(runId: string, status: 'queued' | 'running' | 'waiting_for_user' | 'done' | 'failed' | 'canceled', note?: string): boolean { return this.send(createDeviceMessage('device.run.update', { deviceId: this.options.deviceId, runId, status, note })); }
  sendWorkspaceState(workspaceState: WorkspaceState): boolean { return this.send(createDeviceMessage('device.workspace.state', { deviceId: this.options.deviceId, workspaceState })); }
  sendDeviceTokenAck(): boolean { return this.send(createDeviceMessage('device.device_token.ack', { deviceId: this.options.deviceId })); }

  sendToolRequest(runId: string, toolCallId: string, toolCall: ToolCall): string {
    const toolEventId = crypto.randomUUID();
    this.send(createDeviceMessage('device.tool.request', {
      deviceId: this.options.deviceId,
      runId,
      toolEventId,
      toolCallId,
      toolCall,
      at: Date.now(),
    }));
    return toolEventId;
  }

  sendToolResult(
    runId: string,
    toolEventId: string,
    toolCallId: string,
    toolCall: ToolCall,
    result: {
      ok: boolean;
      error?: { code: string; message: string };
      exitCode?: number;
      truncated?: boolean;
      bytesWritten?: number;
      hunksApplied?: number;
    }
  ): boolean {
    return this.send(createDeviceMessage('device.tool.result', {
      deviceId: this.options.deviceId,
      runId,
      toolEventId,
      toolCallId,
      toolCall,
      result,
      at: Date.now(),
    }));
  }

  private sendHello(): void {
    this.send(createDeviceMessage('device.hello', {
      deviceId: this.options.deviceId,
      deviceName: this.options.deviceName,
      platform: this.options.platform,
      appVersion: this.options.appVersion,
      deviceToken: this.options.deviceToken,
    }));
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw === 'object' && raw !== null && 'v' in raw) {
      const msg = raw as { v: number };
      if (msg.v !== PROTOCOL_VERSION) { console.error(`[WsClient] Protocol version mismatch`); return; }
    }
    const result = parseServerMessage(raw);
    if (!result.success) { console.error('[WsClient] Invalid message:', result.error); return; }
    const message = result.data;
    switch (message.type) {
      case 'server.hello_ack': if (this.helloTimeout) { clearTimeout(this.helloTimeout); this.helloTimeout = null; } this.setStatus('connected'); this.startPingInterval(); break;
      case 'server.error': this.options.onError?.(message.payload); break;
      case 'server.pong': break;
      case 'server.run.start': this.sendRunAccept(message.payload.runId); this.options.onRunStart?.(message.payload.runId, message.payload.goal, message.payload.mode); break;
      case 'server.run.details': this.options.onRunDetails?.((message as ServerRunDetails).payload.run); break;
      case 'server.run.step_update': { const p = (message as ServerRunStepUpdate).payload; this.options.onStepUpdate?.(p.runId, p.step); break; }
      case 'server.run.log': { const p = (message as ServerRunLog).payload; this.options.onRunLog?.(p.runId, p.stepId, { line: p.line, level: p.level, at: p.at }); break; }
      case 'server.approval.request': { const p = (message as ServerApprovalRequest).payload; this.options.onApprovalRequest?.(p.runId, p.approval); break; }
      case 'server.run.canceled': this.options.onRunCanceled?.((message as ServerRunCanceled).payload.runId); break;
      case 'server.device.token': this.options.onDeviceToken?.((message as ServerDeviceToken).payload.deviceToken); break;
      case 'server.action.request': { const p = (message as ServerActionRequest).payload; this.options.onActionRequest?.(p.actionId, p.action); break; }
      default: this.options.onMessage?.(message);
    }
  }

  private setStatus(status: ConnectionStatus): void { if (this.status !== status) { this.status = status; this.options.onStatusChange?.(status); } }
  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.pingInterval = setInterval(() => this.sendPing(), this.pingIntervalMs);
  }
  private scheduleReconnect(url: string): void { if (this.reconnectTimer) return; const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay); this.reconnectAttempts++; this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(url); }, delay); }
  private cleanup(): void { if (this.helloTimeout) { clearTimeout(this.helloTimeout); this.helloTimeout = null; } if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; } if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } }
}
