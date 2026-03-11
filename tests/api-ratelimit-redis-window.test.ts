import assert from 'node:assert/strict';
import test from 'node:test';

import { consumeRateLimit } from '../apps/api/src/lib/ratelimit.ts';
import { redisClient } from '../apps/api/src/lib/redis.ts';

type RedisEntry = {
  value: string;
  expiresAt: number | null;
};

function createFakeRedisStore() {
  const entries = new Map<string, RedisEntry>();

  function purgeExpired(key: string) {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key);
    }
  }

  return {
    incr(_redisUrl: string, key: string) {
      purgeExpired(key);
      const current = entries.get(key);
      const next = (current ? Number.parseInt(current.value, 10) : 0) + 1;
      entries.set(key, {
        value: String(next),
        expiresAt: current?.expiresAt ?? null,
      });
      return Promise.resolve(next);
    },
    expire(_redisUrl: string, key: string, seconds: number) {
      purgeExpired(key);
      const current = entries.get(key);
      if (!current) {
        return Promise.resolve(false);
      }

      entries.set(key, {
        value: current.value,
        expiresAt: Date.now() + (seconds * 1000),
      });
      return Promise.resolve(true);
    },
    pttl(_redisUrl: string, key: string) {
      purgeExpired(key);
      const current = entries.get(key);
      if (!current?.expiresAt) {
        return Promise.resolve(-1);
      }
      return Promise.resolve(Math.max(0, current.expiresAt - Date.now()));
    },
    get(_redisUrl: string, key: string) {
      purgeExpired(key);
      return Promise.resolve(entries.get(key)?.value ?? null);
    },
    set(_redisUrl: string, key: string, value: string, ttlSeconds: number) {
      entries.set(key, {
        value,
        expiresAt: Date.now() + (ttlSeconds * 1000),
      });
      return Promise.resolve(true);
    },
    del(_redisUrl: string, key: string) {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

test('redis-backed rate limiting still blocks requests that span a window boundary', async () => {
  const originalNow = Date.now;
  const originalIncr = redisClient.incr;
  const originalExpire = redisClient.expire;
  const originalPttl = redisClient.pttl;
  const originalGet = redisClient.get;
  const originalSet = redisClient.set;
  const originalDel = redisClient.del;

  const fakeRedis = createFakeRedisStore();
  redisClient.incr = fakeRedis.incr;
  redisClient.expire = fakeRedis.expire;
  redisClient.pttl = fakeRedis.pttl;
  redisClient.get = fakeRedis.get;
  redisClient.set = fakeRedis.set;
  redisClient.del = fakeRedis.del;

  const timestamps = [
    59_994,
    59_995,
    59_996,
    59_997,
    59_998,
    59_999,
    60_000,
    60_001,
    60_002,
    60_003,
    60_004,
    60_005,
    60_006,
    60_007,
    60_008,
  ];
  let index = 0;
  Date.now = () => timestamps[Math.min(index, timestamps.length - 1)];

  try {
    const results = [];
    for (index = 0; index < timestamps.length; index += 1) {
      results.push(await consumeRateLimit('ip:test:auth:login', 10, 60_000, {
        backend: 'redis',
        redisUrl: 'redis://fake',
      }));
    }

    assert.equal(
      results.some((result) => !result.allowed),
      true,
      'expected at least one request to be rejected after 10 attempts within the last minute'
    );
  } finally {
    Date.now = originalNow;
    redisClient.incr = originalIncr;
    redisClient.expire = originalExpire;
    redisClient.pttl = originalPttl;
    redisClient.get = originalGet;
    redisClient.set = originalSet;
    redisClient.del = originalDel;
  }
});
