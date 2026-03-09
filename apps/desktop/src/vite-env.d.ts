/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_HTTP_BASE?: string;
  readonly VITE_API_WS_URL?: string;
  readonly VITE_DESKTOP_ALLOW_INSECURE_LOCALHOST?: string;
  readonly VITE_DESKTOP_CSP_MODE?: string;
  readonly VITE_DESKTOP_UPDATER_ENABLED?: string;
  readonly VITE_DESKTOP_UPDATER_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
