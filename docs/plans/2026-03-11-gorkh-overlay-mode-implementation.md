# GORKH Overlay Mode Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebrand the desktop app as GORKH and add a reversible premium active-work overlay mode without weakening the current desktop auth, approval, or task systems.

**Architecture:** Keep the existing single Tauri `main` window and add an overlay-mode window-state controller plus a React overlay shell. During active work, the same window morphs into a fullscreen, always-on-top, dark translucent experience with a compact bottom-right controller. Existing run/approval/task systems remain underneath and are demoted from the retail surface.

**Tech Stack:** Tauri 2, Rust window commands, React 19, TypeScript, existing desktop tests and security checks.

---

### Task 1: Branding update to GORKH

**Files:**
- Create: `apps/desktop/src/assets/gorkh-wordmark.svg`
- Create: `apps/desktop/src/components/BrandWordmark.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/ChatOverlay.tsx`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/lib/permissions.ts`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Test: `tests/desktop-branding-gorkh.test.mjs`

**Steps:**
1. Write a failing test asserting desktop-visible branding uses `GORKH` and the SVG wordmark exists.
2. Run the focused test and verify it fails for current `AI Operator` strings.
3. Add the SVG wordmark and small brand component.
4. Replace visible desktop-facing branding strings and wire the SVG into the main entry surfaces.
5. Run the focused branding test.
6. Run desktop build/typecheck plus repo gates.

### Task 2: Overlay mode window controller

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/permissions/desktop-ipc.toml`
- Modify: `scripts/check-desktop-security.mjs`
- Modify: `tests/desktop-tauri-commands.test.mjs`
- Test: `tests/desktop-overlay-window-state.test.mjs`

**Steps:**
1. Write a failing test for overlay enter/exit command presence and state restoration behavior.
2. Add Tauri commands to enter/exit overlay mode and snapshot prior window state.
3. Update permissions/security checks.
4. Run focused overlay command tests.

### Task 3: Fullscreen overlay shell

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/ChatOverlay.tsx`
- Create: `apps/desktop/src/components/ActiveOverlayShell.tsx`
- Test: `tests/desktop-overlay-visual-shell.test.mjs`

**Steps:**
1. Write a failing UI test for active overlay mode rendering.
2. Add overlay-state-driven layout and premium dark/glass styling.
3. Hide large retail panels when overlay mode is active.
4. Run focused UI tests.

### Task 4: Bottom-right controller

**Files:**
- Create: `apps/desktop/src/components/OverlayController.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `tests/desktop-overlay-controller.test.mjs`

**Steps:**
1. Write a failing test for the compact controller contents.
2. Add the bottom-right mini-controller with status, stop, pause, and details affordances.
3. Keep it usable while overlay mode is active.
4. Run focused tests.

### Task 5: Active-work retail cleanup

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/RunPanel.tsx`
- Test: `tests/desktop-retail-ux.test.mjs`

**Steps:**
1. Write/update failing tests around hidden/demoted admin/run-heavy surfaces in overlay mode.
2. Move technical content behind details/debug affordances.
3. Run focused UI tests.

### Task 6: Approvals in overlay mode

**Files:**
- Modify: `apps/desktop/src/components/ApprovalModal.tsx`
- Modify: `apps/desktop/src/components/ActionApprovalModal.tsx`
- Modify: `apps/desktop/src/components/ToolApprovalModal.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `tests/desktop-overlay-approvals.test.ts`

**Steps:**
1. Write a failing test proving approvals remain visible and actionable in overlay mode.
2. Restyle/position approval UI for the premium overlay shell.
3. Verify stop all and approval flows still work.
4. Run focused tests and full repo gates.

