import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop main surface emphasizes assistant chat and task progress instead of operator jargon', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const runPanelSource = readFileSync('apps/desktop/src/components/RunPanel.tsx', 'utf8');

  assert.match(appSource, /Advanced|Assistant settings|Debug details/i);
  assert.doesNotMatch(appSource, /Technical details/i, 'retail desktop should avoid operator-flavored copy');
  assert.doesNotMatch(appSource, /Manual launch/i, 'manual launch should not remain on the retail surface');
  assert.doesNotMatch(appSource, /Task history/i, 'retail desktop should not lead with raw run history language');
  assert.doesNotMatch(
    appSource,
    /Experimental Advanced Engine|Experimental Workflow/i,
    'duplicate experimental agent surfaces should not remain visible in the retail shell'
  );

  assert.match(runPanelSource, /Task progress/i, 'run panel should be described as task progress for retail users');
  assert.doesNotMatch(runPanelSource, /Active Run/i, 'run terminology should be removed from the main progress panel');
  assert.doesNotMatch(runPanelSource, /desktop task composer/i, 'empty state should point users back to the assistant, not a task composer');
});

test('desktop retail onboarding uses guided free-AI setup copy on the main surface and hides provider details behind advanced settings', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const freeAiSource = readFileSync('apps/desktop/src/components/FreeAiSetupCard.tsx', 'utf8');

  assert.match(
    appSource,
    /Set Up Free AI|Install local engine|Choose workspace|Ready to use/i,
    'main desktop onboarding should present a guided setup path in product language'
  );
  assert.match(
    appSource,
    /Advanced/i,
    'technical details should move behind an explicit Advanced section'
  );
  assert.doesNotMatch(
    appSource,
    /Provider:\s*\{getLlmProviderLabel|Settings & details/i,
    'primary onboarding should not expose provider state or generic settings-detail copy'
  );

  assert.match(
    freeAiSource,
    /Set Up Free AI|Installing local engine|Downloading AI model|Repair Free AI/i,
    'free AI setup card should describe the guided install flow in plain product language'
  );
  assert.doesNotMatch(
    freeAiSource,
    /Start Free AI|Vision Boost optional/i,
    'the primary setup card should not lead with tier-selection jargon or optional upsells'
  );
});
