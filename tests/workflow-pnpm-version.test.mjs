import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageManager = packageJson.packageManager;
const exactPnpmVersion = packageManager?.match(/^pnpm@(.+)$/)?.[1];

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/desktop-ci.yml',
  '.github/workflows/desktop-release.yml',
];

test('GitHub workflows do not pin a pnpm version that conflicts with packageManager', () => {
  assert.ok(exactPnpmVersion, 'package.json must declare packageManager as pnpm@<exact-version>');

  for (const workflowPath of workflowPaths) {
    const source = readFileSync(workflowPath, 'utf8');
    const actionBlocks = [...source.matchAll(/uses:\s*pnpm\/action-setup@v4([\s\S]{0,160})/g)];

    assert.ok(actionBlocks.length > 0, `${workflowPath} must configure pnpm/action-setup`);

    for (const block of actionBlocks) {
      const snippet = block[1];
      const versionMatch = snippet.match(/\bversion:\s*([^\s]+)/);

      if (!versionMatch) {
        continue;
      }

      assert.equal(
        versionMatch[1],
        exactPnpmVersion,
        `${workflowPath} must use pnpm ${exactPnpmVersion} when pnpm/action-setup pins a version`
      );
    }
  }
});
