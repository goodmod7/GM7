# Stable Desktop Background Updater Design

**Date:** 2026-03-23

## Problem

GORKH stable desktop builds already ship signed updater metadata and enable the Tauri updater plugin, but the app currently only checks the update manifest manually from Settings and reports whether a newer version exists.

Users still need a manual reinstall flow because the app does not yet download or stage updates for restart.

## Goals

- Stable desktop builds should check for updates automatically in the background after launch.
- If an update exists, GORKH should download it in the background without interrupting the user.
- When the update is fully downloaded, GORKH should show a clear `Restart to update` action.
- The actual install should happen only when the user explicitly chooses restart.
- Existing beta behavior should remain unchanged: no updater flow.

## Non-Goals

- Auto-relaunching without user confirmation.
- Supporting background updater behavior on beta builds.
- Reworking the server-side update manifest format.
- Adding persistent updater state across launches in the first implementation.

## Current State

- Stable release workflow writes a Tauri updater config with signed endpoints.
- The desktop runtime enables `tauri_plugin_updater` when `VITE_DESKTOP_UPDATER_ENABLED` is true.
- The Settings panel manually fetches the update manifest URL and shows `Update available`, but does not invoke the Tauri updater install path.
- The frontend updater plugin packages are not currently declared in the desktop app package manifest.

## Chosen Approach

Use the Tauri v2 frontend updater API directly from the desktop React app:

1. On stable builds only, start a single background updater check shortly after app startup.
2. If an update is found, begin background download immediately.
3. Track updater state in the app shell using explicit statuses such as:
   - `idle`
   - `checking`
   - `downloading`
   - `downloaded`
   - `upToDate`
   - `error`
4. Surface the state in Settings, including progress while downloading.
5. When the update is fully downloaded, expose a persistent `Restart to update` action.
6. Clicking restart should install the staged update and relaunch the app.

## UX

### Startup

- No disruptive modal.
- Silent background check on stable builds.
- If no update exists, no prominent banner is required.

### While Downloading

- Settings should show version, download progress, and a message like `Downloading update`.
- The app should avoid duplicate background checks/downloads during the same launch.

### When Ready

- Settings should show `Restart to update`.
- The action should be available until the user restarts or the app exits.

### Failure

- If the updater check or download fails, show a concise updater error in Settings.
- The user should still be able to manually retry the update check from Settings.

## Architecture

- Add a small desktop updater helper module wrapping the Tauri updater/process plugin APIs.
- Keep updater session state in the React app shell and pass it into `SettingsPanel`.
- Reuse the existing Settings updater section rather than creating a separate update surface.
- The updater helper should expose:
  - check-and-download behavior
  - install-and-relaunch behavior
  - progress events normalized into app-friendly state

## Risks

- The Tauri updater frontend packages must be added and stay version-aligned with the existing Tauri stack.
- Windows install behavior may differ from macOS during relaunch/install, so the copy must stay generic.
- If the app starts multiple checks concurrently, users could see inconsistent progress; the implementation must guard against duplicate runs.

## Validation

- Add tests for updater state copy and restart CTA presence in Settings.
- Add tests for stable-only background updater startup behavior in the app shell.
- Typecheck the desktop app after adding the updater packages and app state.
