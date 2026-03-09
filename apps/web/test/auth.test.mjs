import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  clear() {
    this.values.clear();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  removeItem(key) {
    this.values.delete(key);
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function createJsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });
}

async function loadAuthModule(t) {
  const outDir = mkdtempSync(join(tmpdir(), 'gm7-web-auth-'));
  t.after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  const compile = spawnSync(
    'pnpm',
    [
      'exec',
      'tsc',
      '--pretty',
      'false',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      '--lib',
      'DOM,DOM.Iterable,ES2022',
      '--types',
      'node',
      '--rootDir',
      'lib',
      '--outDir',
      outDir,
      'lib/auth.ts',
    ],
    {
      cwd: webRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE: 'https://gm7.onrender.com',
      },
    }
  );

  if (compile.status !== 0) {
    throw new Error(compile.stderr || compile.stdout || 'Failed to compile apps/web/lib/auth.ts');
  }

  process.env.NEXT_PUBLIC_API_BASE = 'https://gm7.onrender.com';
  return import(pathToFileURL(join(outDir, 'auth.js')).href);
}

function installBrowserGlobals() {
  const storage = new MemoryStorage();
  const location = { href: 'https://gm7-tau.vercel.app/login' };
  const windowObject = {
    alert() {},
    localStorage: storage,
    location,
  };

  globalThis.window = windowObject;
  globalThis.localStorage = storage;
  globalThis.document = { cookie: '' };

  return {
    location,
    storage,
  };
}

test('login stores the returned access token and apiFetch reuses it as bearer auth', async (t) => {
  const auth = await loadAuthModule(t);
  const { storage } = installBrowserGlobals();
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });

    if (String(url).endsWith('/auth/login')) {
      return createJsonResponse({
        token: 'access-token-123',
        user: {
          id: 'user-1',
          email: 'user@example.com',
        },
      });
    }

    return createJsonResponse({
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
  };

  await auth.login('user@example.com', 'password-123');

  assert.equal(storage.getItem('ai_operator_access_token'), 'access-token-123');

  await auth.apiFetch('/auth/me');

  assert.equal(calls.length, 2);
  const secondHeaders = new Headers(calls[1].init.headers);
  assert.equal(secondHeaders.get('Authorization'), 'Bearer access-token-123');
});

test('buildApiUrl appends the stored access token for SSE and screen URLs', async (t) => {
  const auth = await loadAuthModule(t);
  const { storage } = installBrowserGlobals();

  storage.setItem('ai_operator_access_token', 'query-token-456');

  assert.equal(typeof auth.buildApiUrl, 'function');
  assert.equal(
    auth.buildApiUrl('/events?deviceId=abc', { includeAccessTokenQuery: true }),
    'https://gm7.onrender.com/events?deviceId=abc&token=query-token-456'
  );
});
