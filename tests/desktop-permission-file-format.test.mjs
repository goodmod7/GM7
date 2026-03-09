import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const permissionPath = 'apps/desktop/src-tauri/permissions/desktop-ipc.toml';

test('desktop app permission file uses Tauri permission-table format', () => {
  const source = readFileSync(permissionPath, 'utf8');

  assert.match(
    source,
    /^\[\[permission\]\]$/m,
    'desktop custom Tauri permissions must be declared in a [[permission]] table so the build can register them'
  );
});
