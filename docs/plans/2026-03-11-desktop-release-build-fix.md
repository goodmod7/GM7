# Desktop Release Build Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unblock the desktop beta release by fixing the three confirmed Rust/Tauri compile regressions and locking them down with regression tests.

**Architecture:** Keep the fix narrowly scoped to the desktop Rust crate. Guard the failure modes with static repo tests first, then make the smallest Cargo and Rust edits needed to restore compatibility with the current Tokio and Tauri versions.

**Tech Stack:** pnpm, Node test runner, Tauri 2, Rust, Tokio

---

### Task 1: Capture The Release Blockers In Tests

**Files:**
- Modify: `tests/desktop-rust-release-prereqs.test.mjs`

**Step 1: Write the failing test**

Add assertions that:

- `apps/desktop/src-tauri/Cargo.toml` enables Tokio `macros`
- `apps/desktop/src-tauri/src/lib.rs` does not contain `.set_maximized(`
- `apps/desktop/src-tauri/src/lib.rs` defines `desktop_auth_listen_cancel` with a `Result<..., ...>` return type

**Step 2: Run test to verify it fails**

Run: `node --test tests/desktop-rust-release-prereqs.test.mjs`

Expected:

- failure because Tokio `macros` is missing
- failure because `.set_maximized(` is still present
- failure because `desktop_auth_listen_cancel` still returns `KeyResult`

**Step 3: Write minimal implementation**

Do not change production code yet. Only add the failing regression assertions.

**Step 4: Run test to verify it still fails for the expected reasons**

Run: `node --test tests/desktop-rust-release-prereqs.test.mjs`

Expected: FAIL with the new release-blocker assertions.

### Task 2: Fix Tokio Macro Support

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Test: `tests/desktop-rust-release-prereqs.test.mjs`

**Step 1: Implement the minimal Cargo fix**

Add Tokio `macros` to the enabled feature list so `tokio::select!` is available to `run_desktop_auth_listener`.

**Step 2: Run targeted test**

Run: `node --test tests/desktop-rust-release-prereqs.test.mjs`

Expected: Tokio feature assertion passes; the other new assertions still fail.

### Task 3: Fix Tauri Window Restore Compatibility

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `tests/desktop-rust-release-prereqs.test.mjs`

**Step 1: Implement the minimal window-state fix**

Replace the unsupported `set_maximized(snapshot.maximized)` call in `restore_overlay_window_snapshot` with Tauri 2-compatible logic:

- if `snapshot.maximized` is true, call `maximize()`
- otherwise call `unmaximize()`

Keep the existing error handling shape.

**Step 2: Run targeted test**

Run: `node --test tests/desktop-rust-release-prereqs.test.mjs`

Expected: `.set_maximized(` assertion passes; the cancel-command signature assertion still fails.

### Task 4: Fix The Async Tauri Command Signature

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `tests/desktop-rust-release-prereqs.test.mjs`

**Step 1: Implement the minimal command fix**

Change `desktop_auth_listen_cancel` to return `Result<KeyResult, String>` and return `Ok(KeyResult { ... })`.

This keeps the frontend payload shape stable while satisfying Tauri’s async command requirement for commands that take referenced inputs like `State<'_, ...>`.

**Step 2: Run targeted test**

Run: `node --test tests/desktop-rust-release-prereqs.test.mjs`

Expected: PASS

### Task 5: Verify The Full Repo Baseline Still Holds

**Files:**
- Verify only

**Step 1: Run targeted desktop command and auth tests**

Run:

- `node --test tests/desktop-rust-release-prereqs.test.mjs`
- `node --test tests/desktop-auth-flow.test.mjs`
- `node --test tests/desktop-overlay-window-state.test.mjs`
- `node --test tests/desktop-tauri-commands.test.mjs`

Expected: PASS

**Step 2: Run the full repo suite**

Run: `pnpm -w test`

Expected: PASS

**Step 3: Optional local Rust verification**

Run if the environment supports Rust:

- `pnpm --filter @ai-operator/desktop tauri:check`

Expected: compile checks pass on a machine with working Rust/Tauri toolchains.
