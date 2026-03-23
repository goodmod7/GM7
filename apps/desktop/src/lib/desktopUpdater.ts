import { parseDesktopError } from './tauriError.js';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';

export type DesktopUpdaterStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error'
  | 'installing';

export interface DesktopUpdaterState {
  status: DesktopUpdaterStatus;
  currentVersion: string;
  nextVersion: string | null;
  progressPercent: number | null;
  bytesDownloaded: number | null;
  bytesTotal: number | null;
  notes: string | null;
  error: string | null;
  restartReady: boolean;
  checkedInBackground: boolean;
}

export interface DesktopUpdaterAutoCheckInput {
  updaterEnabled: boolean;
  backgroundCheckStarted: boolean;
}

export interface DesktopUpdaterCheckOptions {
  currentVersion: string;
  checkedInBackground?: boolean;
}

export interface DesktopUpdaterDownloadOptions {
  currentVersion: string;
  update: Update;
  checkedInBackground?: boolean;
  onStateChange?: (state: DesktopUpdaterState) => void;
}

export interface DesktopUpdaterCheckResult {
  update: Update | null;
  state: DesktopUpdaterState;
}

type UpdaterApi = typeof import('@tauri-apps/plugin-updater');
type ProcessApi = typeof import('@tauri-apps/plugin-process');

let updaterApiPromise: Promise<UpdaterApi> | null = null;
let processApiPromise: Promise<ProcessApi> | null = null;

function getStateFromUpdate(
  status: DesktopUpdaterStatus,
  currentVersion: string,
  update: Pick<Update, 'currentVersion' | 'version' | 'body'> | null,
  checkedInBackground: boolean
): DesktopUpdaterState {
  return {
    status,
    currentVersion: update?.currentVersion || currentVersion,
    nextVersion: update?.version || null,
    progressPercent: null,
    bytesDownloaded: null,
    bytesTotal: null,
    notes: update?.body || null,
    error: null,
    restartReady: false,
    checkedInBackground,
  };
}

function applyDownloadEvent(state: DesktopUpdaterState, event: DownloadEvent): DesktopUpdaterState {
  if (event.event === 'Started') {
    return {
      ...state,
      bytesTotal: event.data.contentLength ?? null,
      bytesDownloaded: 0,
      progressPercent: 0,
    };
  }

  if (event.event === 'Progress') {
    const bytesDownloaded = (state.bytesDownloaded || 0) + event.data.chunkLength;
    const progressPercent = state.bytesTotal
      ? Math.min(100, Math.round((bytesDownloaded / state.bytesTotal) * 100))
      : null;

    return {
      ...state,
      bytesDownloaded,
      progressPercent,
    };
  }

  return state.bytesTotal
    ? {
        ...state,
        bytesDownloaded: state.bytesTotal,
        progressPercent: 100,
      }
    : state;
}

async function loadUpdaterApi(): Promise<UpdaterApi> {
  updaterApiPromise ??= import('@tauri-apps/plugin-updater');
  return updaterApiPromise;
}

async function loadProcessApi(): Promise<ProcessApi> {
  processApiPromise ??= import('@tauri-apps/plugin-process');
  return processApiPromise;
}

export function createIdleDesktopUpdaterState(currentVersion: string = 'unknown'): DesktopUpdaterState {
  return {
    status: 'idle',
    currentVersion,
    nextVersion: null,
    progressPercent: null,
    bytesDownloaded: null,
    bytesTotal: null,
    notes: null,
    error: null,
    restartReady: false,
    checkedInBackground: false,
  };
}

export function shouldAutoCheckDesktopUpdates({
  updaterEnabled,
  backgroundCheckStarted,
}: DesktopUpdaterAutoCheckInput): boolean {
  return updaterEnabled && !backgroundCheckStarted;
}

export function getDesktopUpdaterStatusMessage(state: DesktopUpdaterState): string {
  if (state.status === 'checking') {
    return state.checkedInBackground ? 'Preparing update in the background.' : 'Preparing update check.';
  }

  if (state.status === 'downloading') {
    if (state.progressPercent !== null) {
      return `Downloading update${state.nextVersion ? ` ${state.nextVersion}` : ''} (${state.progressPercent}%).`;
    }
    return `Downloading update${state.nextVersion ? ` ${state.nextVersion}` : ''}.`;
  }

  if (state.status === 'downloaded') {
    return `Update${state.nextVersion ? ` ${state.nextVersion}` : ''} is ready. Restart to update.`;
  }

  if (state.status === 'installing') {
    return 'Restarting to finish the update.';
  }

  if (state.status === 'upToDate') {
    return 'GORKH is up to date.';
  }

  if (state.status === 'error') {
    return state.error || 'Update failed.';
  }

  return 'Ready to check for updates.';
}

export async function checkForDesktopUpdate({
  currentVersion,
  checkedInBackground = false,
}: DesktopUpdaterCheckOptions): Promise<DesktopUpdaterCheckResult> {
  try {
    const { check } = await loadUpdaterApi();
    const update = await check();

    if (!update) {
      return {
        update: null,
        state: {
          ...createIdleDesktopUpdaterState(currentVersion),
          status: 'upToDate',
          checkedInBackground,
        },
      };
    }

    return {
      update,
      state: getStateFromUpdate('checking', currentVersion, update, checkedInBackground),
    };
  } catch (error) {
    return {
      update: null,
      state: {
        ...createIdleDesktopUpdaterState(currentVersion),
        status: 'error',
        error: parseDesktopError(error, 'Failed to check for updates').message,
        checkedInBackground,
      },
    };
  }
}

export async function downloadDesktopUpdate({
  currentVersion,
  update,
  checkedInBackground = false,
  onStateChange,
}: DesktopUpdaterDownloadOptions): Promise<DesktopUpdaterState> {
  let state: DesktopUpdaterState = {
    ...getStateFromUpdate('downloading', currentVersion, update, checkedInBackground),
    progressPercent: 0,
    bytesDownloaded: 0,
  };

  onStateChange?.(state);

  try {
    await update.download((event) => {
      state = applyDownloadEvent(state, event);
      onStateChange?.(state);
    });

    state = {
      ...state,
      status: 'downloaded',
      progressPercent: 100,
      bytesDownloaded: state.bytesDownloaded ?? state.bytesTotal ?? null,
      restartReady: true,
    };
    onStateChange?.(state);
    return state;
  } catch (error) {
    state = {
      ...state,
      status: 'error',
      error: parseDesktopError(error, 'Failed to download update').message,
    };
    onStateChange?.(state);
    return state;
  }
}

export async function installDownloadedDesktopUpdate(update: Update): Promise<void> {
  const { relaunch } = await loadProcessApi();
  await update.install();
  await relaunch();
}

export async function closeDesktopUpdate(update: Update | null | undefined): Promise<void> {
  if (!update) {
    return;
  }

  try {
    await update.close();
  } catch {
    // Best effort cleanup only.
  }
}
