import { Socket } from 'node:net';
import { URL } from 'node:url';

interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  database?: number;
}

type RedisValue = string | null;

let warnedUnavailable = false;

function warnOnce(message: string) {
  if (!warnedUnavailable) {
    warnedUnavailable = true;
    console.warn(`[redis] ${message}`);
  }
}

function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    password: parsed.password || undefined,
    database: parsed.pathname && parsed.pathname !== '/' ? Number.parseInt(parsed.pathname.slice(1), 10) : undefined,
  };
}

function encodeCommand(parts: string[]): string {
  let payload = `*${parts.length}\r\n`;
  for (const part of parts) {
    payload += `$${Buffer.byteLength(part)}\r\n${part}\r\n`;
  }
  return payload;
}

function parseSimpleResp(buffer: string): RedisValue {
  if (!buffer) {
    return null;
  }

  const prefix = buffer[0];
  if (prefix === '+') {
    return buffer.slice(1).trim();
  }

  if (prefix === '-') {
    throw new Error(buffer.slice(1).trim());
  }

  if (prefix === ':') {
    return buffer.slice(1).trim();
  }

  if (prefix === '$') {
    const firstBreak = buffer.indexOf('\r\n');
    const lengthRaw = buffer.slice(1, firstBreak);
    const length = Number.parseInt(lengthRaw, 10);
    if (length === -1) {
      return null;
    }
    const contentStart = firstBreak + 2;
    return buffer.slice(contentStart, contentStart + length);
  }

  return buffer.trim();
}

async function runRawCommand(redisUrl: string, parts: string[]): Promise<RedisValue> {
  const options = parseRedisUrl(redisUrl);
  const socket = new Socket();

  return new Promise<RedisValue>((resolve, reject) => {
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    let accumulated = '';

    socket.setTimeout(2000, () => {
      cleanup();
      reject(new Error('Redis timeout'));
    });

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    socket.on('data', (chunk) => {
      accumulated += chunk.toString('utf8');
      try {
        const parsed = parseSimpleResp(accumulated);
        cleanup();
        resolve(parsed);
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    socket.connect(options.port, options.host, () => {
      const commands: string[][] = [];
      if (options.password) {
        commands.push(['AUTH', options.password]);
      }
      if (typeof options.database === 'number' && !Number.isNaN(options.database)) {
        commands.push(['SELECT', String(options.database)]);
      }
      commands.push(parts);

      for (const command of commands) {
        socket.write(encodeCommand(command));
      }
    });
  });
}

export const redisClient = {
  async ping(redisUrl: string): Promise<boolean> {
    try {
      const result = await runRawCommand(redisUrl, ['PING']);
      return result === 'PONG';
    } catch (err) {
      warnOnce(`unavailable (${err instanceof Error ? err.message : String(err)}); falling back to memory backend`);
      return false;
    }
  },

  async incr(redisUrl: string, key: string): Promise<number | null> {
    try {
      const value = await runRawCommand(redisUrl, ['INCR', key]);
      return value === null ? null : Number.parseInt(value, 10);
    } catch {
      return null;
    }
  },

  async expire(redisUrl: string, key: string, seconds: number): Promise<boolean> {
    try {
      const value = await runRawCommand(redisUrl, ['EXPIRE', key, String(seconds)]);
      return value === '1';
    } catch {
      return false;
    }
  },

  async pttl(redisUrl: string, key: string): Promise<number | null> {
    try {
      const value = await runRawCommand(redisUrl, ['PTTL', key]);
      return value === null ? null : Number.parseInt(value, 10);
    } catch {
      return null;
    }
  },

  async set(redisUrl: string, key: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await runRawCommand(redisUrl, ['SET', key, value, 'EX', String(ttlSeconds)]);
      return result === 'OK';
    } catch {
      return false;
    }
  },

  async get(redisUrl: string, key: string): Promise<string | null> {
    try {
      return await runRawCommand(redisUrl, ['GET', key]);
    } catch {
      return null;
    }
  },

  async del(redisUrl: string, key: string): Promise<void> {
    try {
      await runRawCommand(redisUrl, ['DEL', key]);
    } catch {
      // no-op on cleanup
    }
  },
};
