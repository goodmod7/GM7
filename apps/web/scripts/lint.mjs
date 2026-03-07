import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { cwd } from 'node:process';

const require = createRequire(import.meta.url);

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: cwd(),
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function hasEslint() {
  try {
    require.resolve('eslint');
    return true;
  } catch {
    return false;
  }
}

if (hasEslint()) {
  process.exit(run('next', ['lint', '--max-warnings=0']));
}

console.warn('[lint] ESLint is not installed in this workspace; falling back to TypeScript lint gate (tsc --noEmit).');
process.exit(run('tsc', ['--noEmit']));
