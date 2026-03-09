import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = '.github/workflows/desktop-release.yml';

test('desktop release workflow builds the shared package before desktop bundles', () => {
  const source = readFileSync(workflowPath, 'utf8');

  assert.match(
    source,
    /run:\s*pnpm --filter @ai-operator\/shared build/,
    'desktop release workflow must build @ai-operator/shared before desktop packaging'
  );
});
