import assert from 'node:assert/strict';
import test from 'node:test';

test('frontend local AI helper exposes a conservative tier recommendation model', async () => {
  const imported = await import('../apps/desktop/src/lib/localAi.ts');

  assert.equal(typeof imported.getLocalAiStatus, 'function');
  assert.equal(typeof imported.getLocalAiHardwareProfile, 'function');
  assert.equal(typeof imported.getLocalAiRecommendedTier, 'function');
  assert.equal(typeof imported.recommendLocalAiTierFromHardwareProfile, 'function');
  assert.equal(typeof imported.getLocalAiTierRuntimePlan, 'function');
  assert.equal(typeof imported.isLocalAiInstallActive, 'function');
  assert.equal(typeof imported.resolveManagedLocalLlmBinding, 'function');
  assert.equal(typeof imported.resolveManagedLocalTaskBinding, 'function');

  assert.equal(
    imported.recommendLocalAiTierFromHardwareProfile({
      os: 'windows',
      architecture: 'x86_64',
      logicalCpuCores: 4,
      cpuModel: 'Intel Core i5',
      ramBytes: 8 * 1024 * 1024 * 1024,
      gpuSummary: null,
      gpuClass: 'unknown',
      availableDiskBytes: 18 * 1024 * 1024 * 1024,
      managedRuntimeDir: 'C:/Users/test/AppData/Roaming/AI Operator/local-ai',
    }).tier,
    'light'
  );

  assert.equal(
    imported.recommendLocalAiTierFromHardwareProfile({
      os: 'macos',
      architecture: 'aarch64',
      logicalCpuCores: 8,
      cpuModel: 'Apple M2',
      ramBytes: 16 * 1024 * 1024 * 1024,
      gpuSummary: 'Apple integrated GPU',
      gpuClass: 'integrated',
      availableDiskBytes: 80 * 1024 * 1024 * 1024,
      managedRuntimeDir: '/Users/test/Library/Application Support/AI Operator/local-ai',
    }).tier,
    'standard'
  );

  const visionRecommendation = imported.recommendLocalAiTierFromHardwareProfile({
    os: 'windows',
    architecture: 'x86_64',
    logicalCpuCores: 16,
    cpuModel: 'AMD Ryzen 9',
    ramBytes: 32 * 1024 * 1024 * 1024,
    gpuSummary: 'NVIDIA RTX 4070',
    gpuClass: 'discrete',
    availableDiskBytes: 250 * 1024 * 1024 * 1024,
    managedRuntimeDir: 'C:/Users/test/AppData/Roaming/AI Operator/local-ai',
  });

  assert.equal(visionRecommendation.tier, 'standard');
  assert.equal(visionRecommendation.visionAvailable, true);
  assert.match(
    visionRecommendation.reason.toLowerCase(),
    /vision|heavier|capable/,
    'high-capability machines should get an explanation that vision boost is viable without making it the default'
  );

  assert.deepEqual(imported.getLocalAiTierRuntimePlan('light'), {
    tier: 'light',
    defaultModel: 'qwen2.5:1.5b',
    optionalVisionModel: 'qwen2.5-vl:3b',
  });
  assert.deepEqual(imported.getLocalAiTierRuntimePlan('standard'), {
    tier: 'standard',
    defaultModel: 'qwen2.5:3b',
    optionalVisionModel: 'qwen2.5-vl:3b',
  });
  assert.deepEqual(imported.getLocalAiTierRuntimePlan('vision'), {
    tier: 'vision',
    defaultModel: 'qwen2.5-vl:3b',
    optionalVisionModel: 'qwen2.5-vl:3b',
  });

  assert.deepEqual(
    imported.resolveManagedLocalLlmBinding(
      {
        managedByApp: true,
        managedRuntimeDir: '/tmp/local-ai',
        runtimeBinaryPath: '/tmp/local-ai/runtime/ollama',
        runtimePresent: true,
        runtimeRunning: true,
        externalServiceDetected: false,
        serviceUrl: 'http://127.0.0.1:11434',
        installStage: 'ready',
        selectedTier: 'standard',
        selectedModel: 'qwen2.5:3b',
        installedModels: ['qwen2.5:3b'],
        runtimeSource: 'managed_or_adopted_ollama',
        runtimeVersion: '0.7.0',
        lastError: null,
      },
      {
        tier: 'light',
        reason: 'fallback',
        visionAvailable: false,
        standardAvailable: false,
      }
    ),
    {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
    }
  );

  assert.deepEqual(
    imported.resolveManagedLocalTaskBinding(
      {
        managedByApp: true,
        managedRuntimeDir: '/tmp/local-ai',
        runtimeBinaryPath: '/tmp/local-ai/runtime/ollama',
        runtimePresent: true,
        runtimeRunning: true,
        externalServiceDetected: false,
        serviceUrl: 'http://127.0.0.1:11434',
        installStage: 'ready',
        selectedTier: 'standard',
        selectedModel: 'qwen2.5:3b',
        installedModels: ['qwen2.5:3b'],
        runtimeSource: 'managed_or_adopted_ollama',
        runtimeVersion: '0.7.0',
        lastError: null,
      },
      {
        tier: 'standard',
        reason: 'capable machine',
        visionAvailable: true,
        standardAvailable: true,
      },
      'Open Photoshop and remove the background'
    ),
    {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
      needsVision: true,
      requiresVisionBoost: true,
      visionModel: 'qwen2.5-vl:3b',
    }
  );

  assert.deepEqual(
    imported.resolveManagedLocalTaskBinding(
      {
        managedByApp: true,
        managedRuntimeDir: '/tmp/local-ai',
        runtimeBinaryPath: '/tmp/local-ai/runtime/ollama',
        runtimePresent: true,
        runtimeRunning: true,
        externalServiceDetected: false,
        serviceUrl: 'http://127.0.0.1:11434',
        installStage: 'ready',
        selectedTier: 'standard',
        selectedModel: 'qwen2.5:3b',
        installedModels: ['qwen2.5:3b', 'qwen2.5-vl:3b'],
        runtimeSource: 'managed_or_adopted_ollama',
        runtimeVersion: '0.7.0',
        lastError: null,
      },
      {
        tier: 'standard',
        reason: 'capable machine',
        visionAvailable: true,
        standardAvailable: true,
      },
      'Open Photoshop and remove the background'
    ),
    {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5-vl:3b',
      needsVision: true,
      requiresVisionBoost: false,
      visionModel: 'qwen2.5-vl:3b',
    }
  );

  assert.deepEqual(
    imported.resolveManagedLocalTaskBinding(
      {
        managedByApp: true,
        managedRuntimeDir: '/tmp/local-ai',
        runtimeBinaryPath: '/tmp/local-ai/runtime/ollama',
        runtimePresent: true,
        runtimeRunning: true,
        externalServiceDetected: false,
        serviceUrl: 'http://127.0.0.1:11434',
        installStage: 'ready',
        selectedTier: 'light',
        selectedModel: 'qwen2.5:1.5b',
        installedModels: ['qwen2.5:1.5b'],
        runtimeSource: 'managed_or_adopted_ollama',
        runtimeVersion: '0.7.0',
        lastError: null,
      },
      {
        tier: 'light',
        reason: 'low-end machine',
        visionAvailable: false,
        standardAvailable: false,
      },
      'Fix tests in this repo'
    ),
    {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b',
      needsVision: false,
      requiresVisionBoost: false,
      visionModel: 'qwen2.5-vl:3b',
    }
  );

  assert.equal(imported.isLocalAiInstallActive('planned'), true);
  assert.equal(imported.isLocalAiInstallActive('installing'), true);
  assert.equal(imported.isLocalAiInstallActive('starting'), true);
  assert.equal(imported.isLocalAiInstallActive('ready'), false);
  assert.equal(imported.isLocalAiInstallActive('error'), false);
});
