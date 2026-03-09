import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM'];

export function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
    });

    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    for (const signal of FORWARDED_SIGNALS) {
      process.on(signal, forwardSignal);
    }

    const cleanup = () => {
      for (const signal of FORWARDED_SIGNALS) {
        process.off(signal, forwardSignal);
      }
    };

    child.once('error', (error) => {
      cleanup();
      rejectPromise(error);
    });

    child.once('exit', (code, signal) => {
      cleanup();

      if (signal) {
        rejectPromise(new Error(`${command} ${args.join(' ')} terminated by ${signal}`));
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
        return;
      }

      resolvePromise();
    });
  });
}

export async function runStartup({
  cwd = API_ROOT,
  env = process.env,
  runCommand: runCommandImpl = runCommand,
} = {}) {
  await runCommandImpl('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd, env });
  await runCommandImpl('node', ['dist/index.js'], { cwd, env });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const isDirectExecution = invokedPath === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runStartup().catch((error) => {
    console.error('[start-with-migrate] Failed to start API:', error);
    process.exit(1);
  });
}
