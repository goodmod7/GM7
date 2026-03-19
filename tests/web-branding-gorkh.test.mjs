import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutPath = 'apps/web/app/layout.tsx';
const homePath = 'apps/web/app/page.tsx';

test('web app branding and shell shift to GORKH for the retail surface', () => {
  const layoutSource = readFileSync(layoutPath, 'utf8');
  const homeSource = readFileSync(homePath, 'utf8');

  assert.match(layoutSource, /title:\s*'GORKH'|title:\s*`GORKH`/);
  assert.match(homeSource, /GORKH|Desktop Intelligence Layer/i);
});
