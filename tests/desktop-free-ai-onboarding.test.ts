import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop local AI helper exposes retail-friendly tier guidance and install stage labels', async () => {
  const imported = await import('../apps/desktop/src/lib/localAi.ts');

  assert.equal(typeof imported.getLocalAiTierDetails, 'function');
  assert.equal(typeof imported.getLocalAiInstallStageLabel, 'function');

  const light = imported.getLocalAiTierDetails('light');
  const standard = imported.getLocalAiTierDetails('standard');
  const vision = imported.getLocalAiTierDetails('vision');

  assert.match(light.title, /light/i);
  assert.match(light.downloadSizeLabel, /gb/i);
  assert.match(light.performanceExpectation, /lighter|responsive|average/i);

  assert.match(standard.title, /standard/i);
  assert.match(standard.bestFor, /code|reasoning|planning/i);

  assert.match(vision.title, /vision/i);
  assert.equal(vision.optional, true);
  assert.match(vision.bestFor, /screen|vision|ui/i);

  assert.equal(imported.getLocalAiInstallStageLabel('not_started'), 'Not installed');
  assert.equal(imported.getLocalAiInstallStageLabel('installing'), 'Downloading');
  assert.equal(imported.getLocalAiInstallStageLabel('installed'), 'Installed');
  assert.equal(imported.getLocalAiInstallStageLabel('starting'), 'Starting');
  assert.equal(imported.getLocalAiInstallStageLabel('ready'), 'Ready');
  assert.equal(imported.getLocalAiInstallStageLabel('error'), 'Error');
});

test('desktop retail shell includes a visible Start Free AI onboarding surface', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const componentPath = 'apps/desktop/src/components/FreeAiSetupCard.tsx';

  assert.equal(existsSync(componentPath), true, 'free local AI onboarding component should exist');
  const componentSource = readFileSync(componentPath, 'utf8');

  assert.match(appSource, /Start Free AI|Set up Free AI/i, 'main desktop shell should expose the free local AI onboarding entry point');
  assert.match(componentSource, /Start Free AI|Set up Free AI/i);
  assert.match(componentSource, /Light recommended/i);
  assert.match(componentSource, /Standard recommended/i);
  assert.match(componentSource, /Vision Boost optional/i);
  assert.match(componentSource, /Not installed/i);
  assert.match(componentSource, /Downloading/i);
  assert.match(componentSource, /Installed/i);
  assert.match(componentSource, /Starting/i);
  assert.match(componentSource, /Ready/i);
  assert.match(componentSource, /Error/i);
});
