# Desktop Release Build Fix Design

**Problem**

The desktop beta release `v0.0.6-beta.20` failed on Windows and macOS because the Rust/Tauri desktop crate no longer matches the APIs and features expected by the current dependency set.

**Approved Scope**

Unblock the desktop release by fixing only the confirmed compile blockers:

- missing Tokio macro support for `tokio::select!`
- invalid `WebviewWindow::set_maximized` usage against Tauri 2.10.x
- invalid async Tauri command signature for `desktop_auth_listen_cancel`

Warnings in adjacent agent modules are out of scope unless they directly block the touched code from compiling or make the targeted fix unclear.

**Approach**

Use a narrow TDD pass:

1. Add regression tests that assert the desktop crate:
   - enables Tokio `macros`
   - avoids `.set_maximized(`
   - returns `Result<...>` from `desktop_auth_listen_cancel`
2. Run the targeted tests and confirm they fail for the current code.
3. Apply the minimal Rust/Cargo changes to satisfy those tests.
4. Re-run targeted tests and then the repo test suite.

**Why This Approach**

This fixes the actual release blockers at their source without introducing unrelated desktop runtime changes, dependency pinning, or cleanup churn during a release recovery.
