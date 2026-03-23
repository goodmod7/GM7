import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop hosted Free AI helper resolves the authenticated OpenAI-compatible fallback binding', async () => {
  const imported = await import('../apps/desktop/src/lib/freeAiFallback.ts');

  const runtimeConfig = {
    httpBase: 'https://api.example.com',
    wsUrl: 'wss://api.example.com/ws',
    allowInsecureLocalhost: false,
    production: true,
  };

  assert.equal(
    imported.buildHostedFreeAiBaseUrl(runtimeConfig),
    'https://api.example.com/desktop/free-ai/v1',
    'desktop should point hosted Free AI traffic at the desktop-authenticated OpenAI-compatible API path'
  );

  assert.deepEqual(
    imported.resolveHostedFreeAiBinding(runtimeConfig, 'desktop-device-token'),
    {
      provider: 'openai_compat',
      baseUrl: 'https://api.example.com/desktop/free-ai/v1',
      model: 'gorkh-free-ai',
      apiKeyOverride: 'desktop-device-token',
      supportsVisionOverride: true,
    },
    'hosted Free AI should look like an OpenAI-compatible runtime with desktop bearer auth and vision enabled'
  );

  assert.equal(
    imported.shouldRetryWithHostedFreeAiFallback({
      code: 'LOCAL_AI_COMPATIBILITY_ERROR',
      message: 'Free AI reached a Mac graphics compatibility problem inside the local AI service.',
    }),
    true,
    'known local compatibility failures should trigger hosted fallback'
  );

  assert.equal(
    imported.shouldRetryWithHostedFreeAiFallback({
      code: 'API_ERROR',
      message: 'Remote provider returned 500',
    }),
    false,
    'remote provider failures should not recursively trigger hosted fallback'
  );
});

test('desktop app and local-compatible provider keep a hosted Free AI execution path with vision enabled', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const taskFlowSource = readFileSync('apps/desktop/src/lib/chatTaskFlow.ts', 'utf8');
  const aiAssistSource = readFileSync('apps/desktop/src/lib/aiAssist.ts', 'utf8');
  const assistantEngineSource = readFileSync('apps/desktop/src/lib/assistantEngine.ts', 'utf8');
  const localCompatSource = readFileSync('apps/desktop/src-tauri/src/agent/providers/local_compat.rs', 'utf8');

  assert.match(
    taskFlowSource,
    /hosted_free_ai|providerMode/,
    'pending task confirmations should be able to carry a hosted Free AI route override from intake to execution'
  );

  assert.match(
    appSource,
    /resolveHostedFreeAiBinding|shouldRetryWithHostedFreeAiFallback/,
    'App.tsx should resolve and retry through the hosted Free AI fallback path'
  );

  assert.match(
    aiAssistSource,
    /apiKeyOverride|supportsVisionOverride/,
    'legacy AI Assist runtime settings should accept hosted fallback auth and vision overrides'
  );

  assert.match(
    assistantEngineSource,
    /providerApiKey|providerSupportsVision/,
    'advanced assistant engine should pass hosted fallback auth and vision flags into the Rust agent'
  );

  assert.match(
    localCompatSource,
    /supports_vision:\s*self\.supports_vision/,
    'local-compatible Rust provider should report runtime-configured vision capability instead of hardcoding false'
  );

  assert.match(
    localCompatSource,
    /Some\(&request\.screenshot_base64\)/,
    'local-compatible Rust provider should send the actual screenshot to hosted vision backends'
  );
});
