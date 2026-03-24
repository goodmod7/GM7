import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop parses structured Tauri errors into code and message fields', async () => {
  const imported = await import('../apps/desktop/src/lib/tauriError.ts');

  assert.equal(typeof imported.parseDesktopError, 'function');

  assert.deepEqual(
    imported.parseDesktopError({
      code: 'CONNECTION_FAILED',
      message: 'Failed to connect to Ollama at http://127.0.0.1:11434',
    }),
    {
      code: 'CONNECTION_FAILED',
      message: 'Failed to connect to Ollama at http://127.0.0.1:11434',
    }
  );

  assert.deepEqual(
    imported.parseDesktopError({
      error: {
        code: 'NO_API_KEY',
        message: 'No API key configured',
      },
    }),
    {
      code: 'NO_API_KEY',
      message: 'No API key configured',
    }
  );

  assert.deepEqual(imported.parseDesktopError(new Error('boom')), {
    code: null,
    message: 'boom',
  });
});

test('desktop chat and settings use the shared Tauri error parser for user-facing failures', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');
  const settingsSource = readFileSync('apps/desktop/src/components/SettingsPanel.tsx', 'utf8');
  const compatSource = readFileSync('apps/desktop/src-tauri/src/llm/openai_compat.rs', 'utf8');

  assert.match(
    appSource,
    /parseDesktopError\(err,\s*'The assistant could not respond right now\.'\)/,
    'chat should normalize plain-object Tauri errors before rendering a fallback message'
  );
  assert.match(
    settingsSource,
    /parseDesktopError\(e,\s*'Test failed'\)/,
    'settings test connection should normalize plain-object Tauri errors before categorizing the failure'
  );
  assert.match(
    settingsSource,
    /parsedError\.code === 'LOCAL_AI_COMPATIBILITY_ERROR'/,
    'settings should surface managed Free AI compatibility failures directly instead of wrapping them in generic test-copy'
  );
  assert.match(
    compatSource,
    /Hosted Free AI fallback requires desktop sign-in|Hosted Free AI fallback returned 404/,
    'hosted fallback errors should use hosted wording instead of generic local-server wording'
  );
});
