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

function prune(entry: Entry, now: number): void {
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < entry.windowMs);
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
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
