import assert from 'node:assert/strict';
import test from 'node:test';

test('shared protocol accepts a valid tool lifecycle request payload', async () => {
  const { PROTOCOL_VERSION, parseDeviceMessage } = await import('../packages/shared/dist/index.js');

  const parsed = parseDeviceMessage({
    v: PROTOCOL_VERSION,
    type: 'device.tool.request',
    ts: Date.now(),
    payload: {
      deviceId: 'device-1',
      runId: 'run-1',
      toolEventId: 'tool-event-1',
      toolCallId: 'tool-call-1',
      toolCall: {
        tool: 'terminal.exec',
        cmd: 'pnpm',
        args: [],
      },
      at: Date.now(),
    },
  });

  assert.equal(parsed.success, true);
});

test('shared protocol rejects malformed terminal tool payloads', async () => {
  const { PROTOCOL_VERSION, parseDeviceMessage } = await import('../packages/shared/dist/index.js');

  const parsed = parseDeviceMessage({
    v: PROTOCOL_VERSION,
    type: 'device.tool.request',
    ts: Date.now(),
    payload: {
      deviceId: 'device-1',
      runId: 'run-1',
      toolEventId: 'tool-event-1',
      toolCallId: 'tool-call-1',
      toolCall: {
        tool: 'terminal.exec',
        cmd: 'pnpm',
      },
      at: Date.now(),
    },
  });

  assert.equal(parsed.success, false);
});

test('shared protocol accepts open_app actions in device.action.create payloads', async () => {
  const { PROTOCOL_VERSION, parseDeviceMessage } = await import('../packages/shared/dist/index.js');

  const parsed = parseDeviceMessage({
    v: PROTOCOL_VERSION,
    type: 'device.action.create',
    ts: Date.now(),
    payload: {
      deviceId: 'device-1',
      actionId: 'action-1',
      runId: 'run-1',
      action: {
        kind: 'open_app',
        appName: 'Photoshop',
      },
      source: 'agent',
      createdAt: Date.now(),
    },
  });

  assert.equal(parsed.success, true);
});

test('createServerMessage always stamps the current protocol version', async () => {
  const { PROTOCOL_VERSION, createServerMessage } = await import('../packages/shared/dist/index.js');

  const message = createServerMessage('server.pong', {
    deviceId: 'device-1',
  });

  assert.equal(message.v, PROTOCOL_VERSION);
  assert.equal(message.type, 'server.pong');
  assert.equal(message.payload.deviceId, 'device-1');
});

test('shared protocol accepts server.command and device.command.ack messages', async () => {
  const { PROTOCOL_VERSION, parseServerMessage, parseDeviceMessage } = await import('../packages/shared/dist/index.js');

  const command = parseServerMessage({
    v: PROTOCOL_VERSION,
    type: 'server.command',
    ts: Date.now(),
    payload: {
      deviceId: 'device-1',
      commandId: 'cmd-1',
      commandType: 'run.start',
      payload: {
        runId: 'run-1',
      },
      ts: Date.now(),
    },
  });

  const ack = parseDeviceMessage({
    v: PROTOCOL_VERSION,
    type: 'device.command.ack',
    ts: Date.now(),
    payload: {
      deviceId: 'device-1',
      commandId: 'cmd-1',
      ok: false,
      errorCode: 'TEMP_UNAVAILABLE',
      retryable: true,
    },
  });

  assert.equal(command.success, true);
  assert.equal(ack.success, true);
});

test('shared protocol rejects device.command.ack with unknown error codes', async () => {
  const { PROTOCOL_VERSION, parseDeviceMessage } = await import('../packages/shared/dist/index.js');

  const parsed = parseDeviceMessage({
    v: PROTOCOL_VERSION,
    type: 'device.command.ack',
    ts: Date.now(),
    payload: {
      deviceId: 'device-1',
      commandId: 'cmd-1',
      ok: false,
      errorCode: 'NOT_A_REAL_CODE',
      retryable: false,
    },
  });

  assert.equal(parsed.success, false);
});
