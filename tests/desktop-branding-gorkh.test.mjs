import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop-visible branding uses GORKH and includes the premium SVG wordmark', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const chatOverlaySource = readFileSync('apps/desktop/src/components/ChatOverlay.tsx', 'utf8');
  const brandWordmarkSource = readFileSync('apps/desktop/src/components/BrandWordmark.tsx', 'utf8');
  const permissionsSource = readFileSync('apps/desktop/src/lib/permissions.ts', 'utf8');
  const tauriConfig = readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8');
  const svgPath = 'apps/desktop/src/assets/gorkh-wordmark.svg';

  assert.ok(existsSync(svgPath), 'desktop should ship a GORKH SVG wordmark asset');

  const svgSource = readFileSync(svgPath, 'utf8');

  assert.match(appSource, /BrandWordmark/, 'main desktop shell should render the shared GORKH wordmark');
  assert.match(chatOverlaySource, /BrandWordmark/, 'assistant chat shell should render the shared GORKH wordmark');
  assert.match(brandWordmarkSource, /\bGORKH\b/, 'shared wordmark component should expose the GORKH brand');
  assert.match(permissionsSource, /\bGORKH\b/, 'desktop permission guidance should use the GORKH brand');
  assert.match(tauriConfig, /"productName":\s*"GORKH"/, 'desktop product name should be GORKH');
  assert.match(tauriConfig, /"title":\s*"GORKH"/, 'desktop window title should be GORKH');

  assert.match(svgSource, /<svg[\s>]/i, 'wordmark asset should be a real SVG');
  assert.match(svgSource, /\bGORKH\b/, 'wordmark should render the GORKH name');
  assert.match(svgSource, /#000|black/i, 'wordmark should include the black premium brand base');

  assert.doesNotMatch(appSource, /AI Operator Desktop|AI Operator/, 'retail app shell should not show the old brand');
  assert.doesNotMatch(chatOverlaySource, /AI Operator Desktop|AI Operator/, 'chat shell should not show the old brand');
  assert.doesNotMatch(permissionsSource, /AI Operator Desktop|AI Operator/, 'permission guidance should not show the old brand');
});
