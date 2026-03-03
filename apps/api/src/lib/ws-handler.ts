import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import type {
  DeviceMessage,
  ServerMessage,
  Platform,
  ApprovalDecision,
  ScreenStreamState,
  ControlState,
  ActionStatus,
  RunStep,
  LogLine,
  AgentProposal,
  WorkspaceState,
  ToolSummary,
  ToolEventStatus,
  ToolCall,
  InputAction,
} from '@ai-operator/shared';
import {
  PROTOCOL_VERSION,
  parseDeviceMessage,
  createServerMessage,
  ErrorCode,
  redactActionForLog,
} from '@ai-operator/shared';
import { deviceStore } from '../store/devices.js';
import { runStore } from '../store/runs.js';
import { screenStore } from '../store/screen.js';
import { actionStore } from '../store/actions.js';
import { toolStore } from '../store/tools.js';
import { createRunEngine } from '../engine/runEngine.js';
import { redactToolCallForLogs } from './tool-redaction.js';
import { devicesRepo } from '../repos/devices.js';
import { auditRepo } from '../repos/audit.js';
import { runsRepo } from '../repos/runs.js';
import { actionsRepo } from '../repos/actions.js';
import { toolsRepo } from '../repos/tools.js';
import { config } from '../config.js';
import { ownership } from './ownership.js';
import { consumeRateLimit } from './ratelimit.js';

// Track connected sockets and their device IDs
interface SocketState {
  connectionId: string;
  deviceId: string;
  helloReceived: boolean;
  ownerUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}
const socketToDevice = new Map<WebSocket, SocketState>();

// HELLO timeout in ms
const HELLO_TIMEOUT_MS = 10_000;

function getHeaderValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function getCoarseIp(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }
  if (ip.includes(':')) {
    return `${ip.split(':').slice(0, 4).join(':')}::`;
  }
  return ip;
}

function getSocketAuditContext(state: SocketState | undefined) {
  return {
    ip: state?.ip ?? null,
    userAgent: state?.userAgent ?? null,
  };
}

async function createSocketAuditEvent(
  state: SocketState | undefined,
  event: {
    userId?: string | null;
    deviceId?: string | null;
    runId?: string | null;
    actionId?: string | null;
    toolName?: string | null;
    eventType: string;
    meta?: Record<string, unknown> | null;
  }
) {
  const context = getSocketAuditContext(state);
  try {
    await auditRepo.createEvent({
      ...event,
      ip: context.ip,
      userAgent: context.userAgent,
    });
  } catch {
    // Do not fail live device traffic if audit persistence is unavailable.
  }
}

function getActionAuditMeta(action: InputAction): Record<string, unknown> {
  if (action.kind === 'type') {
    return { kind: 'type', length: action.text.length };
  }
  if (action.kind === 'hotkey') {
    return { kind: 'hotkey', key: action.key };
  }
  return { kind: action.kind };
}

function getToolAuditMeta(toolCall: ToolCall, result?: { ok: boolean; exitCode?: number; error?: { code?: string } }): Record<string, unknown> {
  if (toolCall.tool === 'terminal.exec') {
    const binary = toolCall.cmd.trim().split(/\s+/)[0] || 'unknown';
    return {
      tool: toolCall.tool,
      cmd: binary,
      exitCode: result?.exitCode,
      ok: result?.ok,
      errorCode: result?.error?.code,
    };
  }

  return {
    tool: toolCall.tool,
    pathRel: 'path' in toolCall ? toolCall.path : undefined,
    exitCode: result?.exitCode,
    ok: result?.ok,
    errorCode: result?.error?.code,
  };
}

function enforceSocketRateLimit(
  socket: WebSocket,
  fastify: FastifyInstance,
  state: SocketState | undefined,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const result = consumeRateLimit(key, limit, windowMs);
  if (result.allowed) {
    return true;
  }

  fastify.log.warn(
    {
      connectionId: state?.connectionId,
      deviceId: state?.deviceId,
      retryAfterSeconds: result.retryAfterSeconds,
    },
    'WebSocket message rate limited'
  );

  const errorMsg = createServerMessage('server.error', {
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Rate limited',
  });
  socket.send(JSON.stringify(errorMsg));
  return false;
}

export function generatePairingCode(): string {
  // Generate 8 character uppercase alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed similar looking characters
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function setupWebSocket(fastify: FastifyInstance) {
  fastify.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const connectionId = randomUUID();
    const clientIp = getCoarseIp(req.ip);
    const userAgent = getHeaderValue(req.headers['user-agent']);
    socketToDevice.set(socket, {
      connectionId,
      deviceId: 'unknown',
      helloReceived: false,
      ip: clientIp,
      userAgent,
    });

    fastify.log.info({ connectionId, clientIp, count: socketToDevice.size }, 'WebSocket client connected');

    // Set hello timeout
    const helloTimeout = setTimeout(() => {
      const state = socketToDevice.get(socket);
      if (!state?.helloReceived) {
        fastify.log.warn({ connectionId, clientIp }, 'Client failed to send hello in time, closing connection');
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.MISSING_HELLO,
          message: 'Hello message not received within timeout period',
        });
        socket.send(JSON.stringify(errorMsg));
        socket.close();
      }
    }, HELLO_TIMEOUT_MS);

    socket.on('message', (raw: Buffer) => {
      try {
        const parsed = JSON.parse(raw.toString());
        const messageType = typeof parsed?.type === 'string' ? parsed.type : 'unknown';
        const requestId = typeof parsed?.requestId === 'string' ? parsed.requestId : null;
        const state = socketToDevice.get(socket);

        fastify.log.debug(
          {
            connectionId: state?.connectionId ?? connectionId,
            deviceId: state?.deviceId,
            messageType,
            requestId,
          },
          'Received WebSocket message'
        );

        // Check protocol version first
        if (parsed.v !== PROTOCOL_VERSION) {
          const errorMsg = createServerMessage('server.error', {
            code: ErrorCode.PROTOCOL_VERSION_MISMATCH,
            message: `Expected protocol version ${PROTOCOL_VERSION}, got ${parsed.v}`,
          });
          socket.send(JSON.stringify(errorMsg));
          return;
        }

        // Validate message
        const validation = parseDeviceMessage(parsed);
        if (!validation.success) {
          fastify.log.warn(
            {
              connectionId: state?.connectionId ?? connectionId,
              messageType,
              error: validation.error,
            },
            'Invalid device message'
          );
          const errorMsg = createServerMessage('server.error', {
            code: ErrorCode.INVALID_MESSAGE,
            message: `Invalid message: ${validation.error}`,
          });
          socket.send(JSON.stringify(errorMsg));
          return;
        }

        const message = validation.data;
        const nextState = socketToDevice.get(socket);

        // Require hello as first message
        if (!nextState?.helloReceived && message.type !== 'device.hello') {
          const errorMsg = createServerMessage('server.error', {
            code: ErrorCode.MISSING_HELLO,
            message: 'Expected device.hello as first message',
          });
          socket.send(JSON.stringify(errorMsg));
          return;
        }

        void handleDeviceMessage(socket, message, fastify).catch((err) => {
          fastify.log.error({ err }, 'Failed to process device message');
          const errorMsg = createServerMessage('server.error', {
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Failed to process message',
          });
          socket.send(JSON.stringify(errorMsg));
        });
      } catch (err) {
        fastify.log.error({ err }, 'Failed to process WebSocket message');
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.INVALID_MESSAGE,
          message: 'Failed to parse message',
        });
        socket.send(JSON.stringify(errorMsg));
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimeout);
      const state = socketToDevice.get(socket);
      if (state) {
        socketToDevice.delete(socket);
        if (state.helloReceived) {
          deviceStore.setConnected(state.deviceId, false);
          fastify.log.info({ connectionId: state.connectionId, deviceId: state.deviceId, count: socketToDevice.size }, 'Device disconnected');
        } else {
          fastify.log.info({ connectionId: state.connectionId, clientIp: state.ip, count: socketToDevice.size }, 'Client disconnected (never sent hello)');
        }
      } else {
        fastify.log.info({ connectionId, clientIp, count: socketToDevice.size }, 'Client disconnected (never sent hello)');
      }
    });

    socket.on('error', (err: Error) => {
      fastify.log.error({ err, connectionId, clientIp }, 'WebSocket error');
    });
  });
}

async function handleDeviceMessage(
  socket: WebSocket,
  message: DeviceMessage,
  fastify: FastifyInstance
): Promise<void> {
  const { type, payload, requestId } = message;

  switch (type) {
    case 'device.hello': {
      const { deviceId, deviceName, platform, appVersion, deviceToken } = payload;
      const existingState = socketToDevice.get(socket);

      let ownerUserId: string | null = null;
      if (deviceToken) {
        const tokenMatch = await devicesRepo.findByDeviceToken(deviceToken);
        if (!tokenMatch || tokenMatch.device.deviceId !== deviceId) {
          await createSocketAuditEvent(existingState, {
            deviceId,
            eventType: 'device.hello_token_denied',
          });
          const errorMsg = createServerMessage('server.error', {
            code: ErrorCode.DEVICE_NOT_FOUND,
            message: 'Invalid device token',
          });
          socket.send(JSON.stringify(errorMsg));
          socket.close();
          return;
        }
        ownerUserId = tokenMatch.ownerUserId ?? null;
      }

      // Mark hello received
      socketToDevice.set(socket, {
        connectionId: existingState?.connectionId ?? randomUUID(),
        deviceId,
        helloReceived: true,
        ownerUserId,
        ip: existingState?.ip ?? null,
        userAgent: existingState?.userAgent ?? null,
      });
      const state = socketToDevice.get(socket);

      // Register/update device
      deviceStore.upsert({
        deviceId,
        deviceName,
        platform: platform as Platform,
        appVersion,
        connected: true,
        socket,
      });
      ownership.setDeviceOwner(deviceId, ownerUserId);
      await devicesRepo.upsertHello({
        deviceId,
        deviceName,
        platform: platform as Platform,
        appVersion,
        ownerUserId,
      });

      fastify.log.info({ connectionId: state?.connectionId, deviceId, platform }, 'Device registered');
      await createSocketAuditEvent(state, {
        userId: ownerUserId,
        deviceId,
        eventType: deviceToken ? 'device.hello_token_accepted' : 'device.hello',
      });

      // Check if device has any active runs and send details
      const activeRuns = runStore.getByDevice(deviceId).filter(
        (r) => r.status === 'queued' || r.status === 'running' || r.status === 'waiting_for_user'
      );
      for (const run of activeRuns) {
        const detailsMsg = createServerMessage('server.run.details', {
          deviceId,
          run,
        });
        socket.send(JSON.stringify(detailsMsg));
      }

      // Send hello_ack
      const response = createServerMessage(
        'server.hello_ack',
        { serverTime: Date.now() },
        requestId
      );
      socket.send(JSON.stringify(response));
      break;
    }

    case 'device.pairing.request_code': {
      const { deviceId } = payload;
      const state = socketToDevice.get(socket);

      if (!state || state.deviceId !== deviceId) {
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.DEVICE_NOT_FOUND,
          message: 'Device not found or mismatch',
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      const pairingCode = generatePairingCode();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      deviceStore.setPairingCode(deviceId, pairingCode, expiresAt);
      await devicesRepo.setPairingCode(deviceId, pairingCode, expiresAt);

      fastify.log.info({ deviceId }, 'Generated pairing code');

      const response = createServerMessage(
        'server.pairing.code',
        { deviceId, pairingCode, expiresAt },
        requestId
      );
      socket.send(JSON.stringify(response));
      break;
    }

    case 'device.pairing.confirmed': {
      // This is handled via REST API, but acknowledge receipt
      fastify.log.debug({ deviceId: payload.deviceId }, 'Received pairing.confirmed (ignored - use REST)');
      break;
    }

    case 'device.chat.send': {
      const { deviceId, runId, message: chatMsg } = payload;

      fastify.log.info({ deviceId, runId }, 'Chat message received');

      // Add to run if specified
      if (runId) {
        runStore.addMessage(runId, 'user', chatMsg.text);
      }

      // Echo back as server message
      const response = createServerMessage(
        'server.chat.message',
        {
          deviceId,
          runId,
          message: chatMsg,
        },
        requestId
      );
      socket.send(JSON.stringify(response));
      break;
    }

    case 'device.run.update': {
      const { deviceId, runId, status, note } = payload;

      fastify.log.info({ deviceId, runId, status }, 'Run status update');

      const run = runStore.updateStatus(runId, status, note);
      if (run) {
        await persistRun(runId);
        const ownerUserId = ownership.getRunOwner(runId) ?? undefined;
        if (status === 'done' || status === 'failed' || status === 'canceled') {
          await createSocketAuditEvent(socketToDevice.get(socket), {
            userId: ownerUserId,
            deviceId,
            runId,
            eventType: `run.${status}`,
          });
        }
        const response = createServerMessage(
          'server.run.status',
          { deviceId, runId, status },
          requestId
        );
        socket.send(JSON.stringify(response));
      } else {
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.RUN_NOT_FOUND,
          message: `Run ${runId} not found`,
        });
        socket.send(JSON.stringify(errorMsg));
      }
      break;
    }

    case 'device.ping': {
      const { deviceId } = payload;
      deviceStore.updateLastSeen(deviceId);
      await devicesRepo.updateLastSeen(deviceId);

      const response = createServerMessage(
        'server.pong',
        { deviceId },
        requestId
      );
      socket.send(JSON.stringify(response));
      break;
    }

    case 'device.run.accept': {
      const { deviceId, runId } = payload;
      fastify.log.info({ deviceId, runId }, 'Run accepted by device');
      
      const run = runStore.get(runId);
      if (run) {
        // Only start the server run engine for manual mode
        // AI Assist mode is handled entirely on the device
        if (run.mode !== 'ai_assist') {
          // Start the run engine if not already running
          let engine = runStore.getEngine(runId);
          if (!engine && (run.status === 'queued' || run.status === 'running')) {
            engine = createRunEngine(runId, fastify);
            runStore.setEngine(runId, engine);
            engine.start();
          }
        } else {
          // For AI Assist, just mark as running and let device handle it
          runStore.updateStatus(runId, 'running');
          await persistRun(runId);
          sseBroadcast({ type: 'run_update', run: runStore.get(runId)! });
          fastify.log.info({ runId }, 'AI Assist run accepted - device will drive execution');
        }
      }
      break;
    }

    case 'device.approval.decision': {
      const { deviceId, runId, approvalId, decision, comment } = payload;
      fastify.log.info({ deviceId, runId, approvalId, decision }, 'Approval decision received');

      const run = runStore.get(runId);
      if (!run) {
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.RUN_NOT_FOUND,
          message: `Run ${runId} not found`,
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      if (!run.pendingApproval || run.pendingApproval.approvalId !== approvalId) {
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.APPROVAL_NOT_FOUND,
          message: `Approval ${approvalId} not found or already resolved`,
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Pass decision to run engine (only for manual mode)
      const engine = runStore.getEngine(runId);
      if (engine) {
        engine.handleApproval(decision as ApprovalDecision, comment);
      }
      break;
    }

    case 'device.run.cancel': {
      const { deviceId, runId } = payload;
      fastify.log.info({ deviceId, runId }, 'Run cancel request received');

      const run = runStore.cancel(runId, 'Canceled by device');
      if (run) {
        await persistRun(runId);
        await createSocketAuditEvent(socketToDevice.get(socket), {
          userId: ownership.getRunOwner(runId) ?? undefined,
          deviceId,
          runId,
          eventType: 'run.canceled',
        });
        const response = createServerMessage('server.run.canceled', {
          deviceId,
          runId,
        });
        socket.send(JSON.stringify(response));
      } else {
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.RUN_NOT_FOUND,
          message: `Run ${runId} not found or cannot be canceled`,
        });
        socket.send(JSON.stringify(errorMsg));
      }
      break;
    }

    // Iteration 4: Screen streaming
    case 'device.screen.stream_state': {
      const { deviceId, state } = payload;
      fastify.log.info({ deviceId, enabled: state.enabled, fps: state.fps }, 'Screen stream state update');

      const device = deviceStore.setScreenStreamState(deviceId, state as ScreenStreamState);
      if (!device) {
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.DEVICE_NOT_FOUND,
          message: `Device ${deviceId} not found`,
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // If disabling, clear any stored frame
      if (!state.enabled) {
        screenStore.clearFrame(deviceId);
      }
      await devicesRepo.updateScreenStreamState(deviceId, state as ScreenStreamState);

      // Acknowledge
      const response = createServerMessage(
        'server.screen.ack',
        { deviceId, ok: true },
        requestId
      );
      socket.send(JSON.stringify(response));
      break;
    }

    case 'device.screen.frame': {
      const { deviceId, meta, dataBase64 } = payload;

      // Validate device exists and is connected
      const state = socketToDevice.get(socket);
      if (!state || state.deviceId !== deviceId) {
        const errorMsg = createServerMessage('server.screen.ack', {
          deviceId,
          ok: false,
          error: { code: ErrorCode.DEVICE_NOT_FOUND, message: 'Device not found or mismatch' },
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Check if streaming is enabled
      const streamState = deviceStore.getScreenStreamState(deviceId);
      if (!streamState?.enabled) {
        const errorMsg = createServerMessage('server.screen.ack', {
          deviceId,
          ok: false,
          error: { code: ErrorCode.SCREEN_STREAM_DISABLED, message: 'Screen streaming is disabled' },
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Check rate limit
      if (screenStore.isRateLimited(deviceId)) {
        const errorMsg = createServerMessage('server.screen.ack', {
          deviceId,
          ok: false,
          error: { code: ErrorCode.SCREEN_RATE_LIMITED, message: 'Frame rate limited (max 2 FPS)' },
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Decode base64
      let bytes: Buffer;
      try {
        bytes = Buffer.from(dataBase64, 'base64');
      } catch {
        const errorMsg = createServerMessage('server.screen.ack', {
          deviceId,
          ok: false,
          error: { code: ErrorCode.INTERNAL_ERROR, message: 'Failed to decode frame data' },
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Store frame (with size check inside)
      const stored = screenStore.setFrame(deviceId, meta, bytes);
      if (!stored) {
        const errorMsg = createServerMessage('server.screen.ack', {
          deviceId,
          ok: false,
          error: { code: ErrorCode.SCREEN_FRAME_TOO_LARGE, message: 'Frame too large (max 1MB)' },
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Broadcast screen update via SSE (metadata only, not bytes)
      sseBroadcast({ type: 'screen_update', deviceId, meta });

      fastify.log.debug({ deviceId, frameId: meta.frameId, bytes: meta.byteLength }, 'Screen frame received');

      // Acknowledge
      const response = createServerMessage(
        'server.screen.ack',
        { deviceId, ok: true },
        requestId
      );
      socket.send(JSON.stringify(response));
      break;
    }

    // Iteration 5: Remote control
    case 'device.control.state': {
      const { deviceId, state } = payload;
      fastify.log.info({ deviceId, enabled: state.enabled }, 'Control state update');

      const device = deviceStore.setControlState(deviceId, state as ControlState);
      if (!device) {
        const errorMsg = createServerMessage('server.error', {
          code: ErrorCode.DEVICE_NOT_FOUND,
          message: `Device ${deviceId} not found`,
        });
        socket.send(JSON.stringify(errorMsg));
        return;
      }
      await devicesRepo.updateControlState(deviceId, state as ControlState);

      // Broadcast device update via SSE
      sseBroadcast({ type: 'device_update', device: deviceStore.get(deviceId)! });
      break;
    }

    case 'device.action.ack': {
      const { deviceId, actionId, status } = payload;
      const state = socketToDevice.get(socket);
      if (!enforceSocketRateLimit(
        socket,
        fastify,
        state,
        `device:${deviceId}:control:ingest`,
        config.CONTROL_ACTIONS_PER_10S,
        10_000
      )) {
        return;
      }
      fastify.log.info({ deviceId, actionId, status }, 'Action ack received');

      const action = actionStore.setStatus(actionId, status as ActionStatus);
      if (action) {
        const ownerUserId = ownership.getActionOwner(actionId);
        if (ownerUserId) {
          await actionsRepo.save(action, ownerUserId);
        }
        await createSocketAuditEvent(state, {
          userId: ownerUserId,
          deviceId,
          actionId,
          eventType: `control.${status}`,
          meta: getActionAuditMeta(action.action),
        });
        sseBroadcast({ type: 'action_update', action });
      }
      break;
    }

    case 'device.action.result': {
      const { deviceId, actionId, ok, error } = payload;
      const state = socketToDevice.get(socket);
      if (!enforceSocketRateLimit(
        socket,
        fastify,
        state,
        `device:${deviceId}:control:ingest`,
        config.CONTROL_ACTIONS_PER_10S,
        10_000
      )) {
        return;
      }
      fastify.log.info({ deviceId, actionId, ok }, 'Action result received');

      const action = actionStore.setResult(actionId, ok, error);
      if (action) {
        const ownerUserId = ownership.getActionOwner(actionId);
        if (ownerUserId) {
          await actionsRepo.save(action, ownerUserId);
        }
        await createSocketAuditEvent(state, {
          userId: ownerUserId,
          deviceId,
          actionId,
          eventType: ok ? 'control.executed' : 'control.failed',
          meta: getActionAuditMeta(action.action),
        });
        sseBroadcast({ type: 'action_update', action });
      }
      break;
    }

    // Iteration 6: AI Assist - Device driven updates
    case 'device.run.step_update': {
      const { deviceId, runId, step } = payload;
      fastify.log.info({ deviceId, runId, stepId: step.stepId, status: step.status }, 'Device step update received');

      const run = runStore.applyDeviceStepUpdate(runId, step as RunStep);
      if (run) {
        await persistRun(runId);
        // Broadcast step update via SSE
        sseBroadcast({ type: 'step_update', runId, step: step as RunStep });
        sseBroadcast({ type: 'run_update', run });
      } else {
        fastify.log.warn({ runId }, 'Failed to apply device step update - run not found or not ai_assist mode');
      }
      break;
    }

    case 'device.run.log': {
      const { deviceId, runId, stepId, line, level, at } = payload;
      fastify.log.info({ deviceId, runId, stepId, level }, 'Device run log received');

      const logLine: LogLine = { line, level, at };
      const run = runStore.addRunLog(runId, logLine);
      if (run) {
        await persistRun(runId);
        // Broadcast log via SSE
        sseBroadcast({ type: 'log_line', runId, stepId, log: logLine });
      }
      break;
    }

    case 'device.agent.proposal': {
      const { deviceId, runId, proposal } = payload;
      fastify.log.info({ deviceId, runId, proposalKind: proposal.kind }, 'Agent proposal received');

      const run = runStore.applyAgentProposal(runId, proposal as AgentProposal);
      if (run) {
        await persistRun(runId);
        // Broadcast run update with new proposal
        sseBroadcast({ type: 'run_update', run });
      } else {
        fastify.log.warn({ runId }, 'Failed to apply agent proposal - run not found or not ai_assist mode');
      }
      break;
    }

    case 'device.action.create': {
      const { deviceId, actionId, runId, action, source, createdAt } = payload;
      const state = socketToDevice.get(socket);
      if (!enforceSocketRateLimit(
        socket,
        fastify,
        state,
        `device:${deviceId}:control:ingest`,
        config.CONTROL_ACTIONS_PER_10S,
        10_000
      )) {
        return;
      }
      
      // Log with redaction for sensitive data
      fastify.log.info({ 
        actionId, 
        deviceId, 
        runId,
        source,
        action: redactActionForLog(action),
      }, 'Device action create received');

      // Create action record (already approved locally)
      const deviceAction = actionStore.createActionFromDevice(
        actionId,
        deviceId,
        action,
        source,
        createdAt,
        runId
      );
      const ownerUserId = runId
        ? ownership.getRunOwner(runId)
        : ownership.getDeviceOwner(deviceId) ?? undefined;
      if (ownerUserId) {
        ownership.setActionOwner(actionId, ownerUserId);
        await actionsRepo.save(deviceAction, ownerUserId);
      }
      await createSocketAuditEvent(state, {
        userId: ownerUserId,
        deviceId,
        runId,
        actionId,
        eventType: 'control.requested',
        meta: getActionAuditMeta(action),
      });

      // Increment run action count if part of a run
      if (runId) {
        runStore.incrementActionCount(runId);
        await persistRun(runId);
      }

      // Broadcast action update
      sseBroadcast({ type: 'action_update', action: deviceAction });
      
      // Also broadcast run update (actionCount changed)
      if (runId) {
        const run = runStore.get(runId);
        if (run) {
          sseBroadcast({ type: 'run_update', run });
        }
      }
      break;
    }

    // Iteration 7: Workspace Tools
    case 'device.workspace.state': {
      const { deviceId, workspaceState } = payload;
      fastify.log.info({ deviceId, configured: workspaceState.configured, rootName: workspaceState.rootName }, 'Workspace state update received');

      const device = deviceStore.setWorkspaceState(deviceId, workspaceState as WorkspaceState);
      if (device) {
        await devicesRepo.updateWorkspaceState(deviceId, workspaceState as WorkspaceState);
        // Broadcast device update via SSE
        sseBroadcast({ type: 'device_update', device: deviceStore.get(deviceId)! });
      }
      break;
    }

    case 'device.device_token.ack': {
      fastify.log.info({ deviceId: payload.deviceId }, 'Device token acknowledged');
      break;
    }

    // Iteration 8: Workspace Tools - with tool lifecycle
    case 'device.tool.request': {
      const { deviceId, runId, toolEventId, toolCallId, toolCall, at } = payload;
      const state = socketToDevice.get(socket);
      if (!enforceSocketRateLimit(
        socket,
        fastify,
        state,
        `device:${deviceId}:tool:ingest`,
        config.TOOL_EVENTS_PER_10S,
        10_000
      )) {
        return;
      }

      // Redact sensitive data for logging
      const redacted = redactToolCallForLogs(toolCall as ToolCall);
      fastify.log.info({ deviceId, runId, toolEventId, toolCallId, ...redacted }, 'Tool execution request received');

      const summary: ToolSummary = {
        toolEventId,
        toolCallId,
        runId,
        deviceId,
        tool: toolCall.tool as ToolSummary['tool'],
        pathRel: redacted.pathRel,
        cmd: redacted.cmd,
        status: 'awaiting_user',
        at,
      };

      const existing = toolStore.get(toolEventId);
      const stored = existing
        ? toolStore.update(toolEventId, summary) ?? summary
        : toolStore.add(summary);
      const toolOwnerUserId = ownership.getRunOwner(runId) ?? ownership.getDeviceOwner(deviceId) ?? undefined;
      if (toolOwnerUserId) {
        ownership.setToolOwner(stored.toolEventId, toolOwnerUserId);
        await toolsRepo.save(stored, toolOwnerUserId);
      }
      await createSocketAuditEvent(state, {
        userId: toolOwnerUserId,
        deviceId,
        runId,
        toolName: toolCall.tool,
        eventType: 'tool.requested',
        meta: getToolAuditMeta(toolCall as ToolCall),
      });

      sseBroadcast({ type: 'tool_update', tool: stored });
      break;
    }

    case 'device.tool.result': {
      const { deviceId, runId, toolEventId, toolCallId, toolCall, result, at } = payload;
      const state = socketToDevice.get(socket);
      if (!enforceSocketRateLimit(
        socket,
        fastify,
        state,
        `device:${deviceId}:tool:ingest`,
        config.TOOL_EVENTS_PER_10S,
        10_000
      )) {
        return;
      }

      // Determine final status
      const finalStatus: ToolEventStatus = result.ok ? 'executed' : 'failed';

      const redacted = redactToolCallForLogs(toolCall as ToolCall);

      // Build metadata from result (privacy-respecting)
      const metadata: Partial<ToolSummary> = {};
      if (result.exitCode !== undefined) metadata.exitCode = result.exitCode;
      if (result.truncated !== undefined) metadata.truncated = result.truncated;
      if (result.bytesWritten !== undefined) metadata.bytesWritten = result.bytesWritten;
      if (result.hunksApplied !== undefined) metadata.hunksApplied = result.hunksApplied;
      if (result.error?.code) metadata.errorCode = result.error.code;

      // Try to find existing tool event, or fall back to toolCallId
      let summary = toolStore.get(toolEventId) ?? toolStore.getByToolCallId(toolCallId);

      if (summary) {
        summary = toolStore.update(summary.toolEventId, {
          status: finalStatus,
          at,
          tool: toolCall.tool as ToolSummary['tool'],
          pathRel: redacted.pathRel,
          cmd: redacted.cmd,
          ...metadata,
        }) ?? summary;
      } else {
        summary = {
          toolEventId,
          toolCallId,
          runId,
          deviceId,
          tool: toolCall.tool as ToolSummary['tool'],
          pathRel: redacted.pathRel,
          cmd: redacted.cmd,
          status: finalStatus,
          at,
          ...metadata,
        };
        toolStore.add(summary);
      }
      const toolOwnerUserId = ownership.getRunOwner(runId) ?? ownership.getDeviceOwner(deviceId) ?? undefined;
      if (toolOwnerUserId) {
        ownership.setToolOwner(summary.toolEventId, toolOwnerUserId);
        await toolsRepo.save(summary, toolOwnerUserId);
      }
      await createSocketAuditEvent(state, {
        userId: toolOwnerUserId,
        deviceId,
        runId,
        toolName: toolCall.tool,
        eventType: result.ok ? 'tool.executed' : 'tool.failed',
        meta: getToolAuditMeta(toolCall as ToolCall, {
          ok: result.ok,
          exitCode: result.exitCode,
          error: result.error,
        }),
      });

      fastify.log.info({ 
        deviceId, 
        runId, 
        toolEventId,
        toolCallId,
        ...redacted,
        status: finalStatus,
        ...metadata,
      }, 'Tool execution result received');

      // Broadcast tool update via SSE
      sseBroadcast({ type: 'tool_update', tool: summary });
      break;
    }

    default: {
      fastify.log.warn({ type }, 'Unhandled device message type');
    }
  }
}

async function persistRun(runId: string): Promise<void> {
  const run = runStore.get(runId);
  const ownerUserId = ownership.getRunOwner(runId);
  if (!run || !ownerUserId) return;
  await runsRepo.save(run, ownerUserId);
}

// Helper to send message to a specific device
export function sendToDevice(deviceId: string, message: ServerMessage): boolean {
  for (const [socket, state] of socketToDevice) {
    if (state.deviceId === deviceId) {
      socket.send(JSON.stringify(message));
      return true;
    }
  }
  return false;
}

// Get device socket for sending messages
export function getDeviceSocket(deviceId: string): WebSocket | undefined {
  for (const [socket, state] of socketToDevice) {
    if (state.deviceId === deviceId) {
      return socket;
    }
  }
  return undefined;
}

// Get all connected device IDs
export function getConnectedDeviceIds(): string[] {
  return Array.from(socketToDevice.values())
    .filter((s) => s.helloReceived)
    .map((s) => s.deviceId);
}

export function getWsConnectionsCount(): number {
  return socketToDevice.size;
}

// SSE Broadcast functionality
import { sseBroadcast } from '../engine/runEngine.js';
export { sseBroadcast };
