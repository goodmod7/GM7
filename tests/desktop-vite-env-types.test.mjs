import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop vite env type declarations are available to release builds', () => {
  assert.equal(
    existsSync('apps/desktop/src/vite-env.d.ts'),
    true,
    'desktop Vite env declarations file must exist'
  );

  const gitignore = readFileSync('.gitignore', 'utf8');
  assert.match(
    gitignore,
    /^!apps\/desktop\/src\/vite-env\.d\.ts$/m,
    'desktop Vite env declarations must be unignored so CI/release builds keep ImportMeta env types'
  );
});
