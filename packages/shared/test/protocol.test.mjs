import assert from 'node:assert/strict';
import test from 'node:test';

const { PROTOCOL_VERSION, parseDeviceMessage } = await import('../dist/index.js');

function createBaseEnvelope(type, payload) {
  return {
    v: PROTOCOL_VERSION,
    type,
    ts: Date.now(),
    payload,
  };
}

test('parseDeviceMessage rejects invalid envelope fields', () => {
  const parsed = parseDeviceMessage({
    ...createBaseEnvelope('device.hello', {
      deviceId: 'device-1',
      platform: 'linux',
    }),
    ts: 'not-a-number',
  });

  assert.equal(parsed.success, false);
});

test('parseDeviceMessage accepts a valid device.hello message', () => {
  const parsed = parseDeviceMessage(
    createBaseEnvelope('device.hello', {
      deviceId: 'device-1',
      deviceName: 'Desktop-1',
      platform: 'linux',
      appVersion: '0.0.6',
    })
  );

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.type, 'device.hello');
    assert.equal(parsed.data.payload.deviceId, 'device-1');
  }
});

test('parseDeviceMessage rejects action payloads with out-of-range coordinates', () => {
  const parsed = parseDeviceMessage(
    createBaseEnvelope('device.action.create', {
      deviceId: 'device-1',
      actionId: 'action-1',
      action: {
        kind: 'click',
        x: 1.5,
        y: 0.5,
        button: 'left',
      },
      source: 'agent',
      createdAt: Date.now(),
    })
  );

  assert.equal(parsed.success, false);
});

test('parseDeviceMessage rejects oversized type-action text payloads', () => {
  const parsed = parseDeviceMessage(
    createBaseEnvelope('device.action.create', {
      deviceId: 'device-1',
      actionId: 'action-2',
      action: {
        kind: 'type',
        text: 'a'.repeat(501),
      },
      source: 'agent',
      createdAt: Date.now(),
    })
  );

  assert.equal(parsed.success, false);
});
