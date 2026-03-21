# Desktop Task Confirmation And Glass Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Require explicit user confirmation before each new assistant task starts, surface final assistant results back into chat, and lighten overlay mode into a transparent glass treatment.

**Architecture:** Keep the behavior desktop-local. Add a local pending confirmation state in the desktop shell, reuse the existing assistant run creation/start flow after confirmation, and extend the current proposal-sync/rendering logic to propagate `done` results and corrected status labels through the existing chat and overlay components.

**Tech Stack:** React, TypeScript, Tauri desktop shell, Node test runner

---

### Task 1: Document The Approved Desktop UX Changes

**Files:**
- Create: `docs/plans/2026-03-21-desktop-task-confirmation-overlay-design.md`
- Create: `docs/plans/2026-03-21-desktop-task-confirmation-overlay.md`

**Step 1: Save the approved design**

Write the approved design and scope into the design doc.

**Step 2: Save the implementation plan**

Write this plan so the implementation can be executed deterministically.

### Task 2: Write The Failing Confirmation Tests

**Files:**
- Modify: `tests/desktop-chat-entry.test.ts`

**Step 1: Add a failing test for the confirmation helper behavior**

Introduce a small helper-level contract for building and tracking a pending confirmation before a run starts.

**Step 2: Add a failing source-level test for the main app**

Assert that `App.tsx` keeps a pending task confirmation state and defers task start until explicit confirmation.

**Step 3: Run the targeted test**

Run: `node --test tests/desktop-chat-entry.test.ts`

Expected: fail because confirmation state/flow does not exist yet.

### Task 3: Write The Failing Overlay Result/Status Tests

**Files:**
- Modify: `tests/desktop-overlay-visual-shell.test.mjs`
- Modify: `tests/desktop-overlay-controller.test.mjs`

**Step 1: Add a failing status-label regression**

Assert that `App.tsx` explicitly handles `done` and `error` states instead of falling through to the thinking label.

**Step 2: Add a failing result-sync regression**

Assert that `App.tsx` appends `done` summaries into chat, not only `ask_user` prompts.

**Step 3: Add failing overlay-style regressions**

Assert that the shell/controller styles use lighter translucent glass treatments instead of heavy dark dimming.

**Step 4: Run the targeted tests**

Run: `node --test tests/desktop-overlay-visual-shell.test.mjs tests/desktop-overlay-controller.test.mjs`

Expected: fail because the overlay still uses the old dark treatment and unhandled status fallback.

### Task 4: Implement Task Confirmation In The Desktop Shell

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/ChatOverlay.tsx`

**Step 1: Add local pending confirmation state**

Store the requested task text and confirmation prompt in `App.tsx`.

**Step 2: Gate new-task creation**

Update `handleSendMessage` so new tasks create a confirmation prompt instead of immediately creating the run.

**Step 3: Add confirm/cancel handlers**

Implement local handlers that either proceed with the original task text or clear the pending confirmation.

**Step 4: Render confirm/cancel UI**

Pass the pending confirmation state into `ChatOverlay` and render buttons there.

**Step 5: Clear confirmation state on lifecycle resets**

Clear the pending confirmation on sign-out, stop-AI, successful task start, and explicit cancel.

### Task 5: Surface Done Results And Correct Overlay Labels

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Extend proposal-to-chat sync**

Append `done` summaries to chat exactly once.

**Step 2: Correct overlay labels**

Handle `done` and `error` explicitly in `overlayStatusLabel`.

**Step 3: Keep error surfacing consistent**

Ensure existing `onError` behavior still appends visible agent errors into chat.

### Task 6: Restyle Overlay Components To Transparent Glass

**Files:**
- Modify: `apps/desktop/src/components/ActiveOverlayShell.tsx`
- Modify: `apps/desktop/src/components/OverlayController.tsx`
- Optionally modify: `apps/desktop/src/components/OverlayDetailsPanel.tsx`

**Step 1: Lighten the fullscreen shell**

Replace the heavy dark dim with subtle blur/highlight gradients and near-clear glass.

**Step 2: Lighten the compact controller**

Keep contrast readable but reduce black opacity substantially.

**Step 3: Keep details panel visually aligned**

Bring the details panel into the same lighter glass language if needed.

### Task 7: Run The Updated Tests

**Files:**
- Test: `tests/desktop-chat-entry.test.ts`
- Test: `tests/desktop-overlay-visual-shell.test.mjs`
- Test: `tests/desktop-overlay-controller.test.mjs`

**Step 1: Run the targeted desktop regressions**

Run: `node --test tests/desktop-chat-entry.test.ts tests/desktop-overlay-visual-shell.test.mjs tests/desktop-overlay-controller.test.mjs`

Expected: all pass.

**Step 2: Run the broader assistant desktop checks**

Run: `node --test tests/desktop-assistant-engine.test.ts tests/desktop-retail-ux.test.mjs tests/desktop-auth-flow.test.mjs`

Expected: all pass.

**Step 3: Run desktop typecheck**

Run: `pnpm --filter @ai-operator/desktop typecheck`

Expected: exit 0.
