import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop defines one assistant-engine catalog with ai assist default and advanced agent demoted to experimental', async () => {
  let imported: typeof import('../apps/desktop/src/lib/assistantEngine.ts');
  try {
    imported = await import('../apps/desktop/src/lib/assistantEngine.ts');
  } catch {
    assert.fail('assistantEngine helper should exist');
    return;
  }

  assert.equal(imported.DEFAULT_ASSISTANT_ENGINE_ID, 'advanced_agent');

  const engines = imported.getAssistantEngineCatalog();
  assert.deepEqual(
    engines.map((engine) => engine.id),
    ['advanced_agent', 'ai_assist_legacy']
  );

  const retail = engines.find((engine) => engine.id === 'advanced_agent');
  const experimental = engines.find((engine) => engine.id === 'ai_assist_legacy');

  assert.ok(retail);
  assert.equal(retail?.experimental, false);
  assert.match(
    retail?.description || '',
    /planning|verification|retail assistant/i,
    'retail engine should be the advanced assistant runtime'
  );
  assert.ok(experimental);
  assert.equal(experimental?.experimental, true);
  assert.match(
    experimental?.description || '',
    /legacy|fallback|debug/i,
    'legacy AI Assist should be clearly marked as secondary once the advanced runtime becomes primary'
  );
});

test('desktop chat shell routes through the unified assistant-engine abstraction', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const advancedDialogSource = readFileSync('apps/desktop/src/components/agent/AgentTaskDialog.tsx', 'utf8');
  const workflowSource = readFileSync('apps/desktop/src/components/AgentWorkflow.tsx', 'utf8');

  assert.match(appSource, /createAssistantEngine/, 'desktop app should create the retail engine through the unified assistant engine helper');
  assert.doesNotMatch(appSource, /new AiAssistController/, 'desktop app should no longer construct AiAssistController directly');
  assert.doesNotMatch(
    appSource,
    /Experimental Advanced Engine|Experimental Workflow/,
    'retail desktop should not present the advanced runtime as a separate experimental surface once it powers the main assistant'
  );
  assert.match(
    advancedDialogSource,
    /debug|secondary|internal/i,
    'any remaining extra engine launch surface should be clearly labeled secondary'
  );
  assert.match(
    workflowSource,
    /secondary|debug|internal/i,
    'engineering workflow surface should remain clearly secondary'
  );
});
