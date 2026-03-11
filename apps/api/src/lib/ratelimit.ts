import { redisClient } from './redis.js';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

type Entry = {
  windowMs: number;
  timestamps: number[];
};

const buckets = new Map<string, Entry>();
let warnedRedisFallback = false;

function warnRedisFallbackOnce() {
  if (!warnedRedisFallback) {
    warnedRedisFallback = true;
    console.warn('[ratelimit] Redis backend unavailable, falling back to in-memory rate limits');
  }
}

function prune(entry: Entry, now: number): void {
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < entry.windowMs);
}

function consumeRateLimitMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  const entry: Entry = existing && existing.windowMs === windowMs
    ? existing
    : { windowMs, timestamps: [] };

  prune(entry, now);

  if (entry.timestamps.length >= limit) {
    const retryAfterMs = Math.max(0, windowMs - (now - entry.timestamps[0]));
    buckets.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  entry.timestamps.push(now);
  buckets.set(key, entry);
  return {
    allowed: true,
    remaining: Math.max(0, limit - entry.timestamps.length),
    retryAfterSeconds: 0,
  };
}

function getRedisBucketKey(key: string, bucket: number): string {
  return `ratelimit:${key}:${bucket}`;
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options?: { backend?: 'redis' | 'memory'; redisUrl?: string }
): Promise<RateLimitResult> {
  const backend = options?.backend ?? 'memory';
  if (backend !== 'redis' || !options?.redisUrl) {
    return consumeRateLimitMemory(key, limit, windowMs);
  }

  const now = Date.now();
  const currentBucket = Math.floor(now / windowMs);
  const elapsedInBucketMs = now - (currentBucket * windowMs);
  const counterKey = getRedisBucketKey(key, currentBucket);
  const count = await redisClient.incr(options.redisUrl, counterKey);
  if (count === null) {
    warnRedisFallbackOnce();
    return consumeRateLimitMemory(key, limit, windowMs);
  }

  if (count === 1) {
    const ttlSeconds = Math.max(1, Math.ceil(((2 * windowMs) - elapsedInBucketMs) / 1000));
    await redisClient.expire(options.redisUrl, counterKey, ttlSeconds);
  }

  const previousBucketKey = getRedisBucketKey(key, currentBucket - 1);
  const previousCountRaw = await redisClient.get(options.redisUrl, previousBucketKey);
  const previousCount = previousCountRaw == null ? 0 : Number.parseInt(previousCountRaw, 10) || 0;
  const previousBucketWeight = Math.max(0, (windowMs - elapsedInBucketMs) / windowMs);
  const effectiveCount = count + (previousCount * previousBucketWeight);

  if (effectiveCount > limit) {
    const retryAfterMs = Math.max(1, windowMs - elapsedInBucketMs);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(limit - effectiveCount)),
    retryAfterSeconds: 0,
  };
}

export function getRateLimitKeyCount(): number {
  const now = Date.now();
  let active = 0;

  for (const [key, entry] of buckets) {
    prune(entry, now);
    if (entry.timestamps.length === 0) {
      buckets.delete(key);
      continue;
    }
    active++;
  }

  return active;
}
