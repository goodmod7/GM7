import { readFileSync } from 'node:fs';

const mode = (process.env.VITE_DESKTOP_CSP_MODE || 'prod').trim();
const config = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
const security = config?.app?.security || {};

const prodCsp = security.csp;
const devCsp = security.devCsp;

if (mode === 'prod') {
  if (!prodCsp || typeof prodCsp !== 'string') {
    console.error('Desktop CSP check failed: production CSP must be enabled and non-empty');
    process.exit(1);
  }

  if (!prodCsp.includes("default-src 'self'")) {
    console.error("Desktop CSP check failed: production CSP must include default-src 'self'");
    process.exit(1);
  }

  if (prodCsp.includes("'unsafe-eval'")) {
    console.error('Desktop CSP check failed: production CSP must not include unsafe-eval');
    process.exit(1);
  }

  console.log('Desktop CSP check passed (prod mode)');
  process.exit(0);
}

if (mode === 'dev') {
  if (!devCsp || typeof devCsp !== 'string') {
    console.error('Desktop CSP check failed: devCsp must be configured for dev mode');
    process.exit(1);
  }
  console.log('Desktop CSP check passed (dev mode)');
  process.exit(0);
}

console.error(`Desktop CSP check failed: unknown VITE_DESKTOP_CSP_MODE=${mode}`);
process.exit(1);
