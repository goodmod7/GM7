import type { DeviceAction, InputAction, ActionStatus, ActionError } from '@ai-operator/shared';

// In-memory action store
const actions = new Map<string, DeviceAction>();

// Rate limiting: deviceId -> array of timestamps
const actionTimestamps = new Map<string, number[]>();

// Constants
const MAX_ACTIONS_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const ACTION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_STORED_ACTIONS = 1000;

export const actionStore = {
  load(actionsToLoad: DeviceAction[]): void {
    actions.clear();
    for (const action of actionsToLoad) {
      actions.set(action.actionId, action);
    }
  },

  createAction(deviceId: string, action: InputAction, source: 'web' | 'agent' = 'web', runId?: string): DeviceAction {
    const now = Date.now();
    const deviceAction: DeviceAction = {
      actionId: crypto.randomUUID(),
      deviceId,
      action,
      status: 'requested' as ActionStatus,
      createdAt: now,
      updatedAt: now,
      source,
      runId,
    };

    // Clean up if too many actions
    if (actions.size >= MAX_STORED_ACTIONS) {
      this.cleanup();
    }

    actions.set(deviceAction.actionId, deviceAction);
    return deviceAction;
  },

  // Iteration 6: Create action from device (already approved locally)
  createActionFromDevice(
    actionId: string,
    deviceId: string,
    action: InputAction,
    source: 'web' | 'agent',
    createdAt: number,
    runId?: string
  ): DeviceAction {
    const deviceAction: DeviceAction = {
      actionId,
      deviceId,
      action,
      status: 'approved', // Already approved locally
      createdAt,
      updatedAt: Date.now(),
      source,
      runId,
    };

    if (actions.size >= MAX_STORED_ACTIONS) {
      this.cleanup();
    }

    actions.set(actionId, deviceAction);
    return deviceAction;
  },

  get(actionId: string): DeviceAction | undefined {
    return actions.get(actionId);
  },

  getByDevice(deviceId: string, limit: number = 50): DeviceAction[] {
    return Array.from(actions.values())
      .filter((a) => a.deviceId === deviceId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  getByRun(runId: string, limit: number = 50): DeviceAction[] {
    return Array.from(actions.values())
      .filter((a) => a.runId === runId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  setStatus(actionId: string, status: ActionStatus): DeviceAction | undefined {
    const action = actions.get(actionId);
    if (!action) return undefined;

    action.status = status;
    action.updatedAt = Date.now();
    return action;
  },

  setResult(actionId: string, ok: boolean, error?: ActionError): DeviceAction | undefined {
    const action = actions.get(actionId);
    if (!action) return undefined;

    action.status = ok ? 'executed' : 'failed';
    action.error = error;
    action.updatedAt = Date.now();
    return action;
  },

  // Rate limiting check
  checkRateLimit(deviceId: string): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    let timestamps = actionTimestamps.get(deviceId) || [];

    // Remove timestamps outside the window
    timestamps = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

    const allowed = timestamps.length < MAX_ACTIONS_PER_WINDOW;
    const remaining = Math.max(0, MAX_ACTIONS_PER_WINDOW - timestamps.length);
    const resetIn = timestamps.length > 0 
      ? RATE_LIMIT_WINDOW_MS - (now - timestamps[0]) 
      : 0;

    if (allowed) {
      timestamps.push(now);
    }

    actionTimestamps.set(deviceId, timestamps);
    return { allowed, remaining, resetIn };
  },

  // Cleanup old actions
  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [id, action] of actions) {
      if (now - action.createdAt > ACTION_EXPIRY_MS) {
        actions.delete(id);
        count++;
      }
    }

    // Also cleanup rate limit timestamps
    for (const [deviceId, timestamps] of actionTimestamps) {
      const filtered = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
      if (filtered.length === 0) {
        actionTimestamps.delete(deviceId);
      } else {
        actionTimestamps.set(deviceId, filtered);
      }
    }

    return count;
  },
};

// Periodic cleanup
setInterval(() => {
  const cleaned = actionStore.cleanup();
  if (cleaned > 0) {
    console.log(`[ActionStore] Cleaned up ${cleaned} old actions`);
  }
}, CLEANUP_INTERVAL_MS);
