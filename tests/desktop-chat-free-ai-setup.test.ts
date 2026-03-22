import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop app stages Free AI setup before the first task can run', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const gateIndex = appSource.indexOf('if (!providerConfigured)');
  const conversationIndex = appSource.indexOf('assistantConversationTurn', gateIndex);
  const setupStateIndex = appSource.indexOf('pendingFreeAiSetup', gateIndex);

  assert.notEqual(
    gateIndex,
    -1,
    'App.tsx should keep a providerConfigured gate for the free-plan local path'
  );
  assert.notEqual(
    setupStateIndex,
    -1,
    'App.tsx should keep a dedicated pending Free AI setup state'
  );
  assert.notEqual(
    conversationIndex,
    -1,
    'App.tsx should still contain the assistantConversationTurn intake call'
  );
  assert.ok(
    setupStateIndex < conversationIndex,
    'the pending Free AI setup state must be staged before assistantConversationTurn in the !providerConfigured path'
  );

  const setupSection = appSource.slice(setupStateIndex, conversationIndex);
  assert.match(
    setupSection,
    /Free AI setup[\s\S]{0,220}(approve|approval)/i,
    'the main path should ask the user to approve Free AI setup before installing'
  );
  assert.match(
    setupSection,
    /Retry Free AI/,
    'failed setup should offer a retry action'
  );
  assert.match(
    setupSection,
    /Cancel this task/,
    'failed setup should allow canceling the stored request'
  );
  assert.match(
    setupSection,
    /Open Settings/,
    'failed setup should offer a settings escape hatch from the pending setup state'
  );
  assert.match(
    setupSection,
    /resumeDeferredTaskAfterFreeAiReady|replayDeferredUserTask/,
    'the original request should resume automatically after Free AI becomes ready'
  );
  assert.doesNotMatch(
    setupSection,
    /brew|ollama pull|manual install/i,
    'the retail setup path should not tell users to manually install Ollama or use brew'
  );
});
