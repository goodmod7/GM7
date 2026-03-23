import assert from 'node:assert/strict';
import test from 'node:test';

test('desktop updater helper exposes stable background download state helpers', async () => {
  let imported: typeof import('../apps/desktop/src/lib/desktopUpdater.ts');
  try {
    imported = await import('../apps/desktop/src/lib/desktopUpdater.ts');
  } catch {
    assert.fail('desktop updater helper should exist');
    return;
  }

  assert.equal(typeof imported.createIdleDesktopUpdaterState, 'function');
  assert.equal(typeof imported.getDesktopUpdaterStatusMessage, 'function');
  assert.equal(typeof imported.shouldAutoCheckDesktopUpdates, 'function');

  assert.equal(
    imported.shouldAutoCheckDesktopUpdates({
      updaterEnabled: true,
      backgroundCheckStarted: false,
    }),
    true
  );

  assert.equal(
    imported.shouldAutoCheckDesktopUpdates({
      updaterEnabled: false,
      backgroundCheckStarted: false,
    }),
    false
  );

  assert.match(
    imported.getDesktopUpdaterStatusMessage({
      status: 'downloaded',
      currentVersion: '0.0.19',
      nextVersion: '0.0.20',
      progressPercent: 100,
      bytesDownloaded: null,
      bytesTotal: null,
      notes: 'Bug fixes',
      error: null,
      restartReady: true,
      checkedInBackground: true,
    }),
    /restart to update/i
  );
});
