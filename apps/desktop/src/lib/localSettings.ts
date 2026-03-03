export interface LocalSettingsState {
  startMinimizedToTray: boolean;
  autostartEnabled: boolean;
  screenPreviewEnabled: boolean;
  allowControlEnabled: boolean;
}

export type LocalSettingsKey = keyof LocalSettingsState;
type LocalSettingsListener = (settings: LocalSettingsState) => void;

const STORAGE_KEY = 'ai-operator-local-settings';

const DEFAULT_SETTINGS: LocalSettingsState = {
  startMinimizedToTray: false,
  autostartEnabled: false,
  screenPreviewEnabled: false,
  allowControlEnabled: false,
};

let currentSettings: LocalSettingsState = loadSettings();
const listeners = new Set<LocalSettingsListener>();

function loadSettings(): LocalSettingsState {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalSettingsState>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
}

function notify(): void {
  const snapshot = { ...currentSettings };
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function getSettings(): LocalSettingsState {
  return { ...currentSettings };
}

export function setSetting<K extends LocalSettingsKey>(key: K, value: LocalSettingsState[K]): LocalSettingsState {
  currentSettings = {
    ...currentSettings,
    [key]: value,
  };
  persistSettings();
  notify();
  return getSettings();
}

export function updateSettings(next: Partial<LocalSettingsState>): LocalSettingsState {
  currentSettings = {
    ...currentSettings,
    ...next,
  };
  persistSettings();
  notify();
  return getSettings();
}

export function subscribe(listener: LocalSettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
