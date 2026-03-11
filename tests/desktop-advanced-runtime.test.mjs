import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('advanced runtime no longer hard-fails before execution and exposes a real retail approval loop', () => {
  const runtimeSource = readFileSync('apps/desktop/src-tauri/src/agent/mod.rs', 'utf8');
  const bridgeSource = readFileSync('apps/desktop/src-tauri/src/lib.rs', 'utf8');
  const clientSource = readFileSync('apps/desktop/src/lib/advancedAgent.ts', 'utf8');
  const engineSource = readFileSync('apps/desktop/src/lib/assistantEngine.ts', 'utf8');

  assert.doesNotMatch(
    runtimeSource,
    /Advanced Agent runtime is not yet available in packaged beta builds/,
    'advanced runtime should not still intentionally fail after planning'
  );
  assert.match(
    runtimeSource,
    /ProposalReady|proposal_ready/,
    'advanced runtime should surface real proposals into the retail approval pipeline'
  );
  assert.match(
    bridgeSource,
    /approve_agent_proposal/,
    'desktop bridge should expose approval for advanced-runtime proposals'
  );
  assert.match(
    bridgeSource,
    /deny_agent_proposal/,
    'desktop bridge should expose denial for advanced-runtime proposals'
  );
  assert.match(
    bridgeSource,
    /submit_agent_user_response/,
    'desktop bridge should expose user-response handling for advanced-runtime questions'
  );
  assert.match(clientSource, /invoke\('approve_agent_proposal'/);
  assert.match(clientSource, /invoke\('deny_agent_proposal'/);
  assert.match(clientSource, /invoke\('submit_agent_user_response'/);
  assert.doesNotMatch(
    clientSource,
    /Mock implementation/,
    'advanced-agent client should be runtime-backed instead of mock data'
  );
  assert.doesNotMatch(
    engineSource,
    /not yet wired into the retail approval pipeline/,
    'assistant engine should not report an unimplemented approval loop once the advanced runtime is live'
  );
});

test('advanced agent provider list comes from the native runtime', () => {
  const clientSource = readFileSync('apps/desktop/src/lib/advancedAgent.ts', 'utf8');

  assert.match(
    clientSource,
    /invoke\('list_agent_providers'/,
    'advanced-agent provider list should come from the Tauri runtime rather than a hardcoded array'
  );
});
