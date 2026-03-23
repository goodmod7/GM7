# Stable Desktop Background Updater Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable stable desktop builds to download updates in the background and present a `Restart to update` action when the update is ready.

**Architecture:** Add a thin frontend updater wrapper around the Tauri v2 updater/process plugins, keep updater session state in the app shell, trigger one stable-only background check after startup, and render progress plus restart CTA in the existing Settings updater section.

**Tech Stack:** Tauri desktop app, React, TypeScript, Tauri updater/process frontend plugins, Node test runner with `tsx`

---

### Task 1: Add a failing UI regression for updater progress and restart copy

**Files:**
- Modify: `tests/desktop-retail-ux.test.mjs`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`

**Step 1: Write the failing test**

Require the desktop Settings updater section to expose:
- background update progress copy,
- a `Restart to update` action,
- wording that no longer stops at `Update available`.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-retail-ux.test.mjs`
Expected: FAIL because the updater section only exposes manual manifest check copy today.

**Step 3: Write minimal implementation**

Update the Settings panel markup contract so the new updater state can be rendered.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-retail-ux.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/desktop-retail-ux.test.mjs apps/desktop/src/components/SettingsPanel.tsx
git commit -m "test: cover desktop updater progress and restart copy"
```

### Task 2: Add a failing app-shell regression for stable-only background updater startup

**Files:**
- Modify: `tests/desktop-chat-entry.test.ts`
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/lib/desktopUpdater.ts`

**Step 1: Write the failing test**

Require the app shell to:
- initialize a desktop updater helper,
- start one background updater check,
- keep the updater outside beta/disabled environments.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-chat-entry.test.ts`
Expected: FAIL because no updater helper or startup effect exists yet.

**Step 3: Write minimal implementation**

Create the updater helper contract and wire the shell effect/state shape.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-chat-entry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/desktop-chat-entry.test.ts apps/desktop/src/App.tsx apps/desktop/src/lib/desktopUpdater.ts
git commit -m "feat: start stable desktop update downloads in the background"
```

### Task 3: Add updater plugin dependencies and implement the helper

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/src/lib/desktopUpdater.ts`

**Step 1: Write the smallest missing failing test**

If needed, add a direct helper test that requires:
- updater state normalization,
- progress handling,
- install/relaunch call shape.

**Step 2: Run test to verify it fails**

Run the targeted helper test.
Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

Add:
- `@tauri-apps/plugin-updater`
- `@tauri-apps/plugin-process`

Implement helper functions for:
- `checkForDesktopUpdate`
- `downloadDesktopUpdate`
- `installDownloadedDesktopUpdate`

**Step 4: Run test to verify it passes**

Run the targeted helper test command again.
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/lib/desktopUpdater.ts
git commit -m "feat: add Tauri desktop updater integration"
```

### Task 4: Integrate updater state into the app shell and Settings

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`

**Step 1: Write the smallest missing failing test**

Add or tighten tests for:
- in-progress download status,
- retry check action,
- `Restart to update` action only after download completes.

**Step 2: Run test to verify it fails**

Run the smallest targeted test command.
Expected: FAIL because integration and rendering are incomplete.

**Step 3: Write minimal implementation**

Wire:
- background startup check effect,
- in-memory updater session state,
- Settings progress UI,
- restart action that installs and relaunches.

**Step 4: Run test to verify it passes**

Run the targeted test command again.
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/components/SettingsPanel.tsx tests/desktop-chat-entry.test.ts tests/desktop-retail-ux.test.mjs
git commit -m "feat: surface restart-to-update flow in desktop settings"
```

### Task 5: Verify the complete updater change

**Files:**
- No new files expected

**Step 1: Run focused desktop tests**

Run:

```bash
node --import tsx --test \
  tests/desktop-chat-entry.test.ts \
  tests/desktop-retail-ux.test.mjs \
  tests/desktop-tauri-error-handling.test.ts \
  tests/desktop-free-ai-onboarding.test.ts \
  apps/desktop/src/lib/chatTaskFlow.test.mjs
```

Expected: PASS

**Step 2: Run desktop typecheck**

Run:

```bash
CI=1 pnpm --filter @ai-operator/desktop typecheck
```

Expected: PASS

**Step 3: Inspect diff for scope control**

Run:

```bash
git diff --stat
git diff -- apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/lib/desktopUpdater.ts apps/desktop/src/App.tsx apps/desktop/src/components/SettingsPanel.tsx tests/desktop-chat-entry.test.ts tests/desktop-retail-ux.test.mjs
```

Expected: only updater dependency, helper, app state, and UI/test changes.

**Step 4: Commit final touch-ups if needed**

```bash
git add <relevant files>
git commit -m "test: verify stable desktop background updater flow"
```
