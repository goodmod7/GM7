import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const apiIndexPath = 'apps/api/src/index.ts';
const apiConfigPath = 'apps/api/src/config.ts';

test('API config exposes hosted Free AI fallback settings', () => {
  const source = readFileSync(apiConfigPath, 'utf8');

  assert.match(source, /FREE_AI_FALLBACK_ENABLED/, 'API config should expose a hosted Free AI enable flag');
  assert.match(source, /FREE_AI_FALLBACK_BASE_URL/, 'API config should expose the upstream OpenAI-compatible base URL');
  assert.match(source, /FREE_AI_FALLBACK_MODEL/, 'API config should expose the hosted Free AI model id');
  assert.match(source, /FREE_AI_FALLBACK_VISION_MODEL/, 'API config should optionally expose a dedicated hosted vision model id');
  assert.match(source, /FREE_AI_FALLBACK_DAILY_LIMIT/, 'API config should expose the hosted Free AI daily quota');
});

test('desktop-authenticated hosted Free AI proxy routes exist and stay available to free-plan users', () => {
  const source = readFileSync(apiIndexPath, 'utf8');

  assert.match(
    source,
    /fastify\.get\('\/desktop\/free-ai\/v1\/models'/,
    'API should expose a desktop-authenticated OpenAI-compatible models endpoint for hosted Free AI'
  );

  assert.match(
    source,
    /fastify\.post\('\/desktop\/free-ai\/v1\/chat\/completions'/,
    'API should expose a desktop-authenticated OpenAI-compatible chat completions endpoint for hosted Free AI'
  );

  const route = source.match(/fastify\.post\('\/desktop\/free-ai\/v1\/chat\/completions'[\s\S]*?return reply/);
  assert.ok(route, 'hosted Free AI completions route should be readable from source');

  assert.match(
    route[0],
    /requireDesktopDeviceSession\(request, reply\)/,
    'hosted Free AI proxy should authenticate with the desktop device token'
  );

  assert.match(
    route[0],
    /free-ai-fallback|free_ai_fallback/i,
    'hosted Free AI proxy should enforce a distinct fallback quota key'
  );

  assert.doesNotMatch(
    route[0],
    /requireActiveSubscription/,
    'hosted Free AI rescue path should remain usable on the free desktop plan'
  );
});
