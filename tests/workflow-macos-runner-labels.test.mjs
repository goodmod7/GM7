import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = '.github/workflows/desktop-release.yml';

test('desktop release workflow uses supported macOS runner labels', () => {
  const source = readFileSync(workflowPath, 'utf8');

  assert.match(
    source,
    /runner:\s*macos-15-intel\s+arch:\s*x86_64/s,
    'Intel desktop release job must use macos-15-intel'
  );

  assert.match(
    source,
    /runner:\s*macos-14\s+arch:\s*aarch64/s,
    'Apple Silicon desktop release job must use macos-14'
  );

  assert.doesNotMatch(
    source,
    /runner:\s*macos-13\b/,
    'desktop release workflow must not use unsupported macos-13 runner labels'
  );
});
