# Iteration 23 Plan: Desktop Security Hardening

## Goal

Reduce the desktop blast radius by:
- restricting Tauri IPC to an explicit audited command list
- blocking arbitrary webview navigation and uncontrolled external opens
- validating production API endpoints before the desktop connects
- adding deterministic CI and test coverage for desktop security invariants

## Constraints

- keep local approvals for control and tool actions unchanged
- do not store screenshots server-side
- do not store LLM keys server-side
- avoid adding new npm packages
- use Tauri v2 capabilities and permissions

## Command Inventory

Audited `#[tauri::command]` surface:

- Safe or low-risk UI commands:
  - `tray_update_state`
  - `main_window_show`
  - `main_window_hide`
  - `autostart_supported`
  - `autostart_is_enabled`
  - `autostart_set_enabled`
  - `workspace_get_state`
  - `workspace_clear`
- Privileged commands:
  - `list_displays`
  - `capture_display_png`
  - `input_click`
  - `input_double_click`
  - `input_scroll`
  - `input_type`
  - `input_hotkey`
  - `device_token_set`
  - `device_token_get`
  - `device_token_clear`
  - `set_llm_api_key`
  - `has_llm_api_key`
  - `clear_llm_api_key`
  - `llm_propose_next_action`
  - `workspace_configure`
  - `tool_execute`

Additional wrapper commands to add:
- `workspace_select_directory`
- `open_external_url`

## Files To Change

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/workspace.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/permissions/desktop-ipc.toml`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/SettingsPanel.tsx`
- `apps/desktop/src/lib/desktopRuntimeConfig.ts`
- `apps/desktop/src/vite-env.d.ts`
- `apps/desktop/.env.example`
- `scripts/check-desktop-csp.mjs`
- `scripts/check-desktop-security.mjs`
- `.github/workflows/desktop-ci.yml`
- `package.json`
- `docs/security.md`
- `docs/deploying.md`
- `README.md`
- `tests/desktop-security-config.test.mjs`
- `tests/desktop-tauri-commands.test.mjs`

## TDD Sequence

1. Add failing node tests for:
   - missing capability and permission files
   - Rust command list not matching allowlist
   - production CSP and plugin invariants
   - desktop runtime API URL validation behavior
2. Run focused node tests and confirm red.
3. Implement:
   - Tauri capability and permission files
   - Rust wrappers and webview lockdown
   - runtime API endpoint validator and UI error handling
   - security check script and CI wiring
4. Re-run focused tests until green.
5. Run full verification:
   - `pnpm -w build`
   - `pnpm -w typecheck`
   - `pnpm -w test`
   - `pnpm check:desktop:security`

## Implementation Notes

- Remove direct frontend use of dialog and opener plugin APIs. Use validated Rust commands instead.
- Keep updater plugin registered, but do not grant frontend updater permissions.
- Disable opener plugin auto-handling of external links.
- Restrict production endpoints to `https:` and `wss:` and reject localhost unless `VITE_DESKTOP_ALLOW_INSECURE_LOCALHOST=true`.
- Keep dev mode permissive for localhost `http:` and `ws:`.
