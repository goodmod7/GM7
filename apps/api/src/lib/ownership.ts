const deviceOwners = new Map<string, string | null>();
const runOwners = new Map<string, string>();
const actionOwners = new Map<string, string>();
const toolOwners = new Map<string, string>();

export const ownership = {
  setDeviceOwner(deviceId: string, ownerUserId: string | null) {
    deviceOwners.set(deviceId, ownerUserId);
  },
  getDeviceOwner(deviceId: string): string | null | undefined {
    return deviceOwners.get(deviceId);
  },
  setRunOwner(runId: string, ownerUserId: string) {
    runOwners.set(runId, ownerUserId);
  },
  getRunOwner(runId: string): string | undefined {
    return runOwners.get(runId);
  },
  setActionOwner(actionId: string, ownerUserId: string) {
    actionOwners.set(actionId, ownerUserId);
  },
  getActionOwner(actionId: string): string | undefined {
    return actionOwners.get(actionId);
  },
  setToolOwner(toolEventId: string, ownerUserId: string) {
    toolOwners.set(toolEventId, ownerUserId);
  },
  getToolOwner(toolEventId: string): string | undefined {
    return toolOwners.get(toolEventId);
  },
};
