import { redisClient } from './redis.js';

export interface PresenceRecord {
  connected: boolean;
  lastSeenAt: number;
  ownerUserId?: string | null;
}

const PRESENCE_TTL_SECONDS = 45;
const KEY_PREFIX = 'presence:device:';

type MemoryEntry = PresenceRecord & { expiresAt: number };
const memoryPresence = new Map<string, MemoryEntry>();
let warnedRedisFallback = false;
let nowProvider: () => number = () => Date.now();

function warnRedisFallbackOnce() {
  if (!warnedRedisFallback) {
    warnedRedisFallback = true;
    console.warn('[presence] Redis presence unavailable, falling back to in-memory presence');
  }
}

function nowMs(): number {
  return nowProvider();
}

function memorySet(deviceId: string, record: PresenceRecord) {
  memoryPresence.set(deviceId, {
    ...record,
    expiresAt: nowMs() + PRESENCE_TTL_SECONDS * 1000,
  });
}

function memoryGet(deviceId: string): PresenceRecord | null {
  const entry = memoryPresence.get(deviceId);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= nowMs()) {
    memoryPresence.delete(deviceId);
    return null;
  }

  return {
    connected: entry.connected,
    lastSeenAt: entry.lastSeenAt,
    ownerUserId: entry.ownerUserId,
  };
}

function keyFor(deviceId: string): string {
  return `${KEY_PREFIX}${deviceId}`;
}

function shouldUseRedis(backend: string): boolean {
  return backend === 'redis';
}

export async function setPresence(
  backend: string,
  redisUrl: string,
  deviceId: string,
  ownerUserId: string | null | undefined,
  connected: boolean
): Promise<void> {
  const payload: PresenceRecord = {
    connected,
    lastSeenAt: nowMs(),
    ownerUserId,
  };

  if (shouldUseRedis(backend)) {
    const ok = await redisClient.set(redisUrl, keyFor(deviceId), JSON.stringify(payload), PRESENCE_TTL_SECONDS);
    if (ok) {
      return;
    }
    warnRedisFallbackOnce();
  }

  memorySet(deviceId, payload);
}

export async function touchPresence(
  backend: string,
  redisUrl: string,
  deviceId: string
): Promise<void> {
  const existing = await getPresence(backend, redisUrl, deviceId);
  if (!existing) {
    return;
  }

  await setPresence(backend, redisUrl, deviceId, existing.ownerUserId, true);
}

export async function clearPresence(backend: string, redisUrl: string, deviceId: string): Promise<void> {
  if (shouldUseRedis(backend)) {
    await redisClient.del(redisUrl, keyFor(deviceId));
  }
  memoryPresence.delete(deviceId);
}

export async function getPresence(backend: string, redisUrl: string, deviceId: string): Promise<PresenceRecord | null> {
  if (shouldUseRedis(backend)) {
    const raw = await redisClient.get(redisUrl, keyFor(deviceId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PresenceRecord;
        return parsed;
      } catch {
        return null;
      }
    }
  }

  return memoryGet(deviceId);
}

export function __setNowProviderForTests(provider: () => number) {
  nowProvider = provider;
}

export function __resetNowProviderForTests() {
  nowProvider = () => Date.now();
}
