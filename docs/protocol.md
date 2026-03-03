# AI Operator Protocol

This document describes the WebSocket protocol used for communication between desktop devices and the server.

## Protocol Version

Current version: **1**

All messages must include `v: 1` in their envelope.

## Message Envelope

All messages use the following envelope structure:

```typescript
{
  v: 1,                    // Protocol version
  type: "device.hello",    // Message type
  requestId?: string,      // Optional request ID for correlation
  ts: 1712345678901,       // Timestamp (Unix ms)
  payload: { ... }         // Message-specific payload
}
```

## Device → Server Messages

### device.hello

Initial handshake. Must be sent within 10 seconds of connection.

```typescript
{
  v: 1,
  type: "device.hello",
  ts: number,
  payload: {
    deviceId: string;       // Unique device identifier (UUID)
    deviceName?: string;    // Human-readable name
    platform: "macos" | "windows" | "linux" | "unknown";
    appVersion?: string;    // Desktop app version
  }
}
```

### device.pairing.request_code

Request a pairing code for this device.

```typescript
{
  v: 1,
  type: "device.pairing.request_code",
  ts: number,
  payload: {
    deviceId: string;
  }
}
```

### device.pairing.confirmed

(Reserved) Sent when device confirms pairing. Currently handled via REST API.

```typescript
{
  v: 1,
  type: "device.pairing.confirmed",
  ts: number,
  payload: {
    deviceId: string;
    pairingCode: string;
  }
}
```

### device.chat.send

Send a chat message.

```typescript
{
  v: 1,
  type: "device.chat.send",
  ts: number,
  payload: {
    deviceId: string;
    runId?: string;         // Optional: associate with a run
    message: {
      role: "user" | "agent";
      text: string;
      createdAt: number;
    }
  }
}
```

### device.run.update

Update the status of a run.

```typescript
{
  v: 1,
  type: "device.run.update",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    status: "queued" | "running" | "waiting_for_user" | "done" | "failed" | "canceled";
    note?: string;          // Optional status note
  }
}
```

### device.ping

Keepalive ping.

```typescript
{
  v: 1,
  type: "device.ping",
  ts: number,
  payload: {
    deviceId: string;
  }
}
```

### device.run.accept

Device acknowledges receipt of a run.

```typescript
{
  v: 1,
  type: "device.run.accept",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
  }
}
```

### device.approval.decision

Respond to an approval request.

```typescript
{
  v: 1,
  type: "device.approval.decision",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    approvalId: string;
    decision: "approved" | "denied";
    comment?: string;
  }
}
```

### device.run.cancel

Cancel an active run from the device.

```typescript
{
  v: 1,
  type: "device.run.cancel",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
  }
}
```

### device.screen.stream_state

Update screen streaming state (Iteration 4).

```typescript
{
  v: 1,
  type: "device.screen.stream_state",
  ts: number,
  payload: {
    deviceId: string;
    state: {
      enabled: boolean;       // Stream on/off
      fps: 1 | 2;            // Frames per second (max 2)
      displayId?: string;     // Which display to capture
    }
  }
}
```

### device.screen.frame

Send a screen capture frame (Iteration 4).

```typescript
{
  v: 1,
  type: "device.screen.frame",
  ts: number,
  payload: {
    deviceId: string;
    meta: {
      frameId: string;       // Unique frame identifier
      width: number;         // Image width in pixels
      height: number;        // Image height in pixels
      mime: "image/png";     // Image format
      at: number;            // Timestamp (Unix ms)
      byteLength: number;    // Size of decoded image bytes
    }
    dataBase64: string;      // PNG image as base64 (max ~1.5MB)
  }
}
```

### device.control.state

Update remote control state (Iteration 5). Sent when user toggles "Allow Control".

```typescript
{
  v: 1,
  type: "device.control.state",
  ts: number,
  payload: {
    deviceId: string;
    state: {
      enabled: boolean;      // Whether control is allowed
      updatedAt: number;     // Unix ms
      requestedBy?: string;  // Client ID that requested control
    }
  }
}
```

### device.workspace.state

Workspace badge state for Iteration 8. Only safe metadata is sent.

```typescript
{
  v: 1,
  type: "device.workspace.state",
  ts: number,
  payload: {
    deviceId: string;
    workspaceState: {
      configured: boolean;
      rootName?: string;    // Workspace folder name only, never an absolute path
    }
  }
}
```

### device.tool.request

Tool lifecycle start for Iteration 8. This is sent before local execution so the server/web can show a pending tool event.

```typescript
{
  v: 1,
  type: "device.tool.request",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    toolEventId: string;
    toolCallId: string;
    toolCall: ToolCall;
    at: number;
  }
}
```

### device.tool.result

Tool lifecycle completion for Iteration 8. The payload stays metadata-only: no file contents and no terminal args.

```typescript
{
  v: 1,
  type: "device.tool.result",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    toolEventId: string;
    toolCallId: string;
    toolCall: ToolCall;
    result: {
      ok: boolean;
      error?: { code: string; message: string };
      exitCode?: number;
      truncated?: boolean;
      bytesWritten?: number;
      hunksApplied?: number;
    };
    at: number;
  }
}
```

### device.action.ack

Acknowledge action request (Iteration 5). Sent when modal is shown to user.

```typescript
{
  v: 1,
  type: "device.action.ack",
  ts: number,
  payload: {
    deviceId: string;
    actionId: string;
    status: "awaiting_user" | "approved" | "denied";
  }
}
```

### device.action.result

Report action execution result (Iteration 5). Sent after attempting to execute.

```typescript
{
  v: 1,
  type: "device.action.result",
  ts: number,
  payload: {
    deviceId: string;
    actionId: string;
    status: "executed" | "failed";
    error?: { code: string; message: string };
  }
}
```

### device.run.step_update

**Iteration 6**: Update step status in AI Assist mode. Device-driven step updates.

```typescript
{
  v: 1,
  type: "device.run.step_update",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    step: {
      stepId: string;
      title: string;
      status: "pending" | "running" | "done" | "failed" | "blocked";
      startedAt?: number;
      endedAt?: number;
      logs: Array<{
        line: string;
        level: "info" | "warn" | "error";
        at: number;
      }>;
    }
  }
}
```

### device.run.log

**Iteration 6**: Add log line to a run. Device-driven logging for AI Assist mode.

```typescript
{
  v: 1,
  type: "device.run.log",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    stepId?: string;        // Optional: associate with specific step
    line: string;
    level: "info" | "warn" | "error";
    at: number;
  }
}
```

### device.agent.proposal

**Iteration 6**: Send AI agent proposal. Device sends this after getting a proposal from LLM.

```typescript
{
  v: 1,
  type: "device.agent.proposal",
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    proposal: AgentProposal;  // See AgentProposal types below
  }
}
```

**AgentProposal types:**

```typescript
// Propose an action to take
{
  kind: "propose_action";
  action: InputAction;      // click, type, scroll, etc.
  rationale: string;        // Why this action (max 2000 chars)
  confidence?: number;      // 0.0 - 1.0
}

// Ask user for clarification
{
  kind: "ask_user";
  question: string;         // Question to ask user (max 2000 chars)
}

// Mark task as complete
{
  kind: "done";
  summary: string;          // Completion summary (max 2000 chars)
}
```

### device.action.create

**Iteration 6**: Create action record (device-initiated). Used by AI Assist to record approved actions.

```typescript
{
  v: 1,
  type: "device.action.create",
  ts: number,
  payload: {
    deviceId: string;
    actionId: string;       // Generated by device
    runId?: string;         // Optional: associated run
    action: InputAction;
    source: "agent";        // Always "agent" for AI Assist
    createdAt: number;
  }
}
```

## Server → Device Messages

### server.hello_ack

Acknowledgment of device.hello.

```typescript
{
  v: 1,
  type: "server.hello_ack",
  requestId?: string,      // Echoed from device.hello
  ts: number,
  payload: {
    serverTime: number;     // Server timestamp
  }
}
```

### server.pairing.code

Generated pairing code for device.

```typescript
{
  v: 1,
  type: "server.pairing.code",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    pairingCode: string;    // 8-char uppercase alphanumeric
    expiresAt: number;      // Unix ms timestamp
  }
}
```

### server.chat.message

Incoming chat message (echo or from server/AI).

```typescript
{
  v: 1,
  type: "server.chat.message",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    runId?: string;
    message: {
      role: "user" | "agent";
      text: string;
      createdAt: number;
    }
  }
}
```

### server.run.start

Start a new run on the device.

```typescript
{
  v: 1,
  type: "server.run.start",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    goal: string;           // The task to accomplish
    // Iteration 6: AI Assist fields (optional for backward compatibility)
    mode?: "manual" | "ai_assist";
    constraints?: {
      maxActions: number;
      maxRuntimeMinutes: number;
    };
  }
}
```

### server.run.status

Status update for a run.

```typescript
{
  v: 1,
  type: "server.run.status",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    status: "queued" | "running" | "waiting_for_user" | "done" | "failed" | "canceled";
  }
}
```

### server.run.details

Full run details including steps.

```typescript
{
  v: 1,
  type: "server.run.details",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    run: {
      runId: string;
      deviceId: string;
      goal: string;
      status: RunStatus;
      createdAt: number;
      updatedAt: number;
      reason?: string;
      // Iteration 6: AI Assist fields
      mode?: "manual" | "ai_assist";
      constraints?: {
        maxActions: number;
        maxRuntimeMinutes: number;
      };
      actionCount?: number;
      lastAgentEventAt?: number;
      latestProposal?: AgentProposal;
      steps: Array<{
        stepId: string;
        title: string;
        status: "pending" | "running" | "done" | "failed" | "blocked";
        startedAt?: number;
        endedAt?: number;
        logs: Array<{
          line: string;
          level: "info" | "warn" | "error";
          at: number;
        }>;
      }>;
      pendingApproval?: {
        approvalId: string;
        runId: string;
        title: string;
        description: string;
        risk: "low" | "medium" | "high";
        expiresAt: number;
        status: "pending" | "approved" | "denied" | "expired";
        decisionAt?: number;
      };
    }
  }
}
```

### server.run.step_update

Step status update.

```typescript
{
  v: 1,
  type: "server.run.step_update",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    step: {
      stepId: string;
      title: string;
      status: "pending" | "running" | "done" | "failed" | "blocked";
      startedAt?: number;
      endedAt?: number;
      logs: Array<{
        line: string;
        level: "info" | "warn" | "error";
        at: number;
      }>;
    }
  }
}
```

### server.run.log

Log line for a run step.

```typescript
{
  v: 1,
  type: "server.run.log",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    stepId?: string;
    line: string;
    level: "info" | "warn" | "error";
    at: number;
  }
}
```

### server.approval.request

Request user approval for a step.

```typescript
{
  v: 1,
  type: "server.approval.request",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
    approval: {
      approvalId: string;
      runId: string;
      title: string;
      description: string;
      risk: "low" | "medium" | "high";
      expiresAt: number;
      status: "pending" | "approved" | "denied" | "expired";
      decisionAt?: number;
    }
  }
}
```

### server.run.canceled

Run has been canceled.

```typescript
{
  v: 1,
  type: "server.run.canceled",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    runId: string;
  }
}
```

### server.screen.ack

Acknowledgment for screen streaming operations (Iteration 4).

```typescript
{
  v: 1,
  type: "server.screen.ack",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    ok: true;
  } | {
    deviceId: string;
    ok: false;
    error: {
      code: "DEVICE_NOT_FOUND" | "SCREEN_STREAM_DISABLED" | "SCREEN_FRAME_TOO_LARGE" | "SCREEN_RATE_LIMITED" | "INTERNAL_ERROR";
      message: string;
    }
  }
}
```

### server.action.request

Request device to perform an input action (Iteration 5). Desktop must show approval modal.

```typescript
{
  v: 1,
  type: "server.action.request",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
    actionId: string;      // Unique action identifier
    action: InputAction;   // See InputAction types below
    requestedAt: number;   // Unix ms
  }
}
```

**InputAction Types:**

```typescript
// Mouse click (normalized coordinates 0-1)
{ kind: "click"; x: number; y: number; button: "left" | "right" | "middle"; }

// Double-click
{ kind: "double_click"; x: number; y: number; button: "left" | "right" | "middle"; }

// Scroll (clamped to ±2000)
{ kind: "scroll"; dx: number; dy: number; }

// Type text (max 500 chars, never logged)
{ kind: "type"; text: string; }

// Hotkey combination
{ kind: "hotkey"; key: string; modifiers?: ("shift" | "ctrl" | "alt" | "meta")[]; }
```

### server.error

Error response.

```typescript
{
  v: 1,
  type: "server.error",
  requestId?: string,
  ts: number,
  payload: {
    code: 
      | "INVALID_MESSAGE"
      | "PROTOCOL_VERSION_MISMATCH"
      | "MISSING_HELLO"
      | "DEVICE_NOT_FOUND"
      | "PAIRING_INVALID_CODE"
      | "PAIRING_EXPIRED"
      | "RUN_NOT_FOUND"
      | "APPROVAL_NOT_FOUND"
      | "SCREEN_STREAM_DISABLED"
      | "SCREEN_FRAME_TOO_LARGE"
      | "SCREEN_RATE_LIMITED"
      | "INTERNAL_ERROR";
    message: string;
  }
}
```

### server.pong

Response to device.ping.

```typescript
{
  v: 1,
  type: "server.pong",
  requestId?: string,
  ts: number,
  payload: {
    deviceId: string;
  }
}
```

## Run Status States

```
queued              → Initial state when run is created
  ↓
running             → Device has accepted and steps are executing
  ↓
waiting_for_user    → Paused for user approval
  ↓ (approved)
running             → Continue with remaining steps
  ↓
done | failed | canceled  ← Final states
```

## Step Status States

```
pending   → Not started yet
running   → Currently executing
done      → Completed successfully
failed    → Failed to complete
blocked   → Waiting for user approval
```

## Screen Streaming (Iteration 4)

### Limitations & Privacy

- **Opt-in only**: Screen streaming is OFF by default; user must explicitly enable
- **Max FPS**: 2 frames per second (configurable: 1 or 2 FPS)
- **Max resolution**: Downscaled to 1280px width (aspect ratio preserved)
- **Max frame size**: 1MB decoded
- **Storage**: Only latest frame kept in memory, expires after 60 seconds
- **No persistence**: Frames are never written to disk or database
- **No recording**: Only live preview, no video recording capability

### Flow

1. Device sends `device.screen.stream_state` with `enabled: true` and `fps`
2. Server acknowledges with `server.screen.ack`
3. Device periodically captures screen and sends `device.screen.frame`
4. Server validates, stores latest frame, broadcasts `screen_update` via SSE
5. Web dashboard displays image from `/devices/:id/screen.png`

## AI Assist Mode (Iteration 6)

AI Assist mode enables the device to use an LLM to propose actions one at a time based on the current screen and goal. All actions require explicit local user approval.

### Run Modes

- `manual` (default): Server-driven execution with the 4-step deterministic plan
- `ai_assist`: Device-driven execution using LLM proposals

### Run Constraints (AI Assist)

Default constraints when creating an AI Assist run:
- `maxActions`: 20 (maximum number of actions per run)
- `maxRuntimeMinutes`: 20 (maximum runtime in minutes)

### AI Assist Flow

1. Web dashboard creates run with `mode: "ai_assist"`
2. Server sends `server.run.start` with mode and constraints
3. Device starts AI loop:
   a. Captures screenshot
   b. Sends to LLM for proposal
   c. Sends `device.agent.proposal` to server
   d. Shows proposal card to user with Approve/Reject
   e. If approved, executes action locally
   f. Sends `device.action.create` and `device.action.result` to server
4. Loop continues until:
   - AI sends `done` proposal
   - User stops the AI
   - Action/runtime limits reached

### Security

- API keys are stored in the OS keychain (never sent to server)
- Every action requires explicit user approval on desktop
- Screenshots and typed text are never persisted on server

## REST Endpoints

### GET /health
Health check.

Response: `{ ok: true, timestamp: number, version: string }`

### GET /devices
List all devices.

Response: `{ devices: Device[] }`

### GET /devices/:deviceId
Get specific device.

Response: `{ device: Device }`

### POST /devices/:deviceId/pair
Pair a device with a pairing code.

Body: `{ pairingCode: string }`

Response: `{ ok: true, device: Device }` or `{ error: string }`

### GET /devices/:deviceId/screen/meta
Get screen frame metadata (Iteration 4).

Response: `{ ok: true, meta: ScreenFrameMeta }` or 404

### GET /devices/:deviceId/screen.png
Get latest screen frame as PNG image (Iteration 4).

Returns: `image/png` with `Cache-Control: no-store`

### GET /runs
List all runs.

Response: `{ runs: Run[] }`

### GET /runs/:runId
Get specific run.

Response: `{ run: Run }`

### POST /runs
Create a new run.

Body: `{ deviceId: string, goal: string, mode?: "manual" | "ai_assist" }`

Response: `{ run: Run }` or `{ error: string }`

### POST /runs/:runId/cancel
Cancel an active run.

Body: `{ reason?: string }`

Response: `{ run: Run }` or `{ error: string }`

### GET /events
Server-Sent Events endpoint for real-time updates.

Events:
- `connected` - Initial connection
- `run_update` - Run status changed
- `step_update` - Step status changed
- `log_line` - New log line added
- `screen_update` - New screen frame available (Iteration 4)
- `action_update` - Action status changed (Iteration 5)
- `tool_update` - Tool lifecycle update (Iteration 8)

## Device Object

```typescript
interface Device {
  deviceId: string;
  deviceName?: string;
  platform: "macos" | "windows" | "linux" | "unknown";
  appVersion?: string;
  connected: boolean;
  paired: boolean;
  pairingCode?: string;
  pairingExpiresAt?: number;
  lastSeenAt: number;
  screenStreamState?: {
    enabled: boolean;
    fps: 1 | 2;
    displayId?: string;
  };
  controlState?: {
    enabled: boolean;
    updatedAt: number;
    requestedBy?: string;
  };
  workspaceState?: {
    configured: boolean;
    rootName?: string;
  };
}
```

## Tool Event Model

```typescript
type ToolEventStatus =
  | "requested"
  | "awaiting_user"
  | "approved"
  | "denied"
  | "executed"
  | "failed";

interface ToolSummary {
  toolEventId: string;
  toolCallId: string;
  runId?: string;
  deviceId: string;
  tool: "fs.list" | "fs.read_text" | "fs.write_text" | "fs.apply_patch" | "terminal.exec";
  pathRel?: string;       // Relative path only
  cmd?: string;           // Command name only
  status: ToolEventStatus;
  exitCode?: number;
  truncated?: boolean;
  errorCode?: string;
  at: number;
}
```

`tool_update` SSE payload:

```typescript
{
  type: "tool_update";
  tool: ToolSummary;
}
```

## Run Object

```typescript
interface Run {
  runId: string;
  deviceId: string;
  goal: string;
  status: "queued" | "running" | "waiting_for_user" | "done" | "failed" | "canceled";
  createdAt: number;
  updatedAt: number;
  reason?: string;        // Failure/cancellation reason
  steps: RunStep[];
  pendingApproval?: ApprovalRequest;
  // Iteration 6: AI Assist fields
  mode?: "manual" | "ai_assist";
  constraints?: {
    maxActions: number;
    maxRuntimeMinutes: number;
  };
  actionCount?: number;
  lastAgentEventAt?: number;
  latestProposal?: AgentProposal;
}

interface RunStep {
  stepId: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "blocked";
  startedAt?: number;
  endedAt?: number;
  logs: Array<{
    line: string;
    level: "info" | "warn" | "error";
    at: number;
  }>;
}

interface ApprovalRequest {
  approvalId: string;
  runId: string;
  title: string;
  description: string;
  risk: "low" | "medium" | "high";
  expiresAt: number;
  status: "pending" | "approved" | "denied" | "expired";
  decisionAt?: number;
}
```

## Error Handling

1. **Protocol Version Mismatch**: Server responds with `server.error` and keeps connection open
2. **Invalid Message**: Server responds with `server.error` and keeps connection open
3. **Missing Hello**: Server closes connection after 10s timeout
4. **Other Errors**: Server responds with `server.error` containing appropriate error code

## TypeScript Support

Use the shared package for runtime validation:

```typescript
import { 
  createDeviceMessage, 
  createServerMessage,
  parseDeviceMessage,
  parseServerMessage,
  createScreenFrameMeta
} from '@ai-operator/shared';

// Create a message
const hello = createDeviceMessage('device.hello', {
  deviceId: 'uuid-here',
  platform: 'macos'
});

// Parse incoming message
const result = parseServerMessage(raw);
if (result.success) {
  console.log(result.data.type);
}

// Create screen frame meta
const meta = createScreenFrameMeta(1920, 1080, 45000);
```
