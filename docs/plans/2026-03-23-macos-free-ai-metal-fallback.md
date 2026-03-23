# macOS Free AI Metal Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically recover managed Free AI on macOS from known Ollama Metal crashes by restarting in CPU-safe compatibility mode and retrying once.

**Architecture:** Detect recognized macOS Metal runner failures in the desktop local-Ollama layer, distinguish managed runtime from external service, and only auto-fallback the managed runtime. Persist compatibility-mode state in local AI metadata/status so chat, settings, and support details can explain what happened without dumping raw backend logs.

**Tech Stack:** Tauri desktop app, Rust local AI/runtime orchestration, TypeScript React UI, Node test runner with `tsx`

---

### Task 1: Add a failing regression test for the Metal crash classification and fallback contract

**Files:**
- Modify: `tests/desktop-tauri-error-handling.test.ts`
- Create or modify: `apps/desktop/src/lib/localAiError.ts`

**Step 1: Write the failing test**

Add tests that require a helper to:
- classify the pasted Metal crash text as a managed-runtime compatibility failure,
- distinguish that from generic Ollama 500s,
- produce retail-safe messages for managed vs external runtime sources.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-tauri-error-handling.test.ts`
Expected: FAIL because the new helper and classifications do not exist yet.

**Step 3: Write minimal implementation**

Create a small shared TS helper with:
- Metal crash signature detection
- managed/external compatibility messaging

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-tauri-error-handling.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/desktop-tauri-error-handling.test.ts apps/desktop/src/lib/localAiError.ts
git commit -m "test: cover macOS Free AI Metal fallback messaging"
```

### Task 2: Add a failing backend/runtime test for managed fallback metadata and launch mode

**Files:**
- Modify: `apps/desktop/src-tauri/src/local_ai.rs`
- Modify or create: Rust tests near `apps/desktop/src-tauri/src/local_ai.rs`

**Step 1: Write the failing test**

Add a unit test for the runtime metadata/state helpers that requires:
- a compatibility-mode flag to exist,
- managed runtime launch env to include CPU-safe settings when enabled,
- crash classification helper to recognize the Metal failure signature.

**Step 2: Run test to verify it fails**

Run: `cargo test -p ai-operator-desktop local_ai`
Expected: FAIL because compatibility mode helpers and metadata fields do not exist yet.

**Step 3: Write minimal implementation**

Add:
- metadata/state field for compatibility mode,
- crash signature detector,
- launch env branch for CPU-safe mode.

**Step 4: Run test to verify it passes**

Run: `cargo test -p ai-operator-desktop local_ai`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/local_ai.rs
git commit -m "feat: add managed Free AI compatibility mode state"
```

### Task 3: Add a failing integration-style test for single retry behavior in chat/settings paths

**Files:**
- Modify: `tests/desktop-chat-entry.test.ts`
- Modify: `tests/desktop-chat-free-ai-setup.test.ts`
- Modify: `tests/desktop-retail-ux.test.mjs`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`

**Step 1: Write the failing test**

Add tests that require:
- managed Free AI errors with the Metal signature to render compatibility-mode messaging instead of raw compiler dumps,
- a single-retry recovery path to exist conceptually in the app flow,
- support details to expose compatibility mode.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-chat-entry.test.ts tests/desktop-chat-free-ai-setup.test.ts tests/desktop-retail-ux.test.mjs`
Expected: FAIL because the UI does not yet know about compatibility mode.

**Step 3: Write minimal implementation**

Update UI helpers/components to:
- map recognized compatibility failures to retail-safe copy,
- show compatibility-mode status in support details.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-chat-entry.test.ts tests/desktop-chat-free-ai-setup.test.ts tests/desktop-retail-ux.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/desktop-chat-entry.test.ts tests/desktop-chat-free-ai-setup.test.ts tests/desktop-retail-ux.test.mjs apps/desktop/src/App.tsx apps/desktop/src/components/SettingsPanel.tsx
git commit -m "feat: surface Free AI compatibility mode recovery"
```

### Task 4: Implement the managed-runtime fallback and retry path

**Files:**
- Modify: `apps/desktop/src-tauri/src/local_ai.rs`
- Modify: `apps/desktop/src-tauri/src/llm/native_ollama.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/localAi.ts`
- Modify: `apps/desktop/src/lib/tauriError.ts`
- Create or modify: `apps/desktop/src/lib/localAiError.ts`

**Step 1: Write the smallest missing failing test**

Before editing request/retry code, add any remaining narrow test needed for:
- one retry only,
- managed-only fallback,
- external-service no-auto-fallback behavior.

**Step 2: Run test to verify it fails**

Run the smallest targeted command that covers the new test.
Expected: FAIL because the request layer still returns the raw Ollama error.

**Step 3: Write minimal implementation**

Implement:
- shared crash classifier,
- managed runtime compatibility-mode persistence,
- managed runtime restart helper,
- single automatic retry after recognized crash,
- structured user-facing error message for unrecovered compatibility failures.

**Step 4: Run test to verify it passes**

Run the targeted test command again.
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/local_ai.rs apps/desktop/src-tauri/src/llm/native_ollama.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/localAi.ts apps/desktop/src/lib/tauriError.ts apps/desktop/src/lib/localAiError.ts
git commit -m "fix: auto-recover managed Free AI from macOS Metal crashes"
```

### Task 5: Verify the complete change set

**Files:**
- No new files expected

**Step 1: Run focused JS/TS tests**

Run:

```bash
node --import tsx --test \
  tests/desktop-tauri-error-handling.test.ts \
  tests/desktop-chat-entry.test.ts \
  tests/desktop-chat-free-ai-setup.test.ts \
  tests/desktop-free-ai-onboarding.test.ts \
  tests/desktop-retail-ux.test.mjs
```

Expected: PASS

**Step 2: Run desktop typecheck**

Run:

```bash
CI=1 pnpm --filter @ai-operator/desktop typecheck
```

Expected: PASS

**Step 3: Run relevant Rust test target if available**

Run:

```bash
cargo test -p ai-operator-desktop local_ai
```

Expected: PASS or a clearly explained environment limitation.

**Step 4: Inspect diff for accidental scope creep**

Run:

```bash
git diff --stat
git diff -- apps/desktop/src-tauri/src/local_ai.rs apps/desktop/src-tauri/src/llm/native_ollama.rs apps/desktop/src/App.tsx apps/desktop/src/components/SettingsPanel.tsx apps/desktop/src/lib/localAi.ts apps/desktop/src/lib/localAiError.ts tests/desktop-tauri-error-handling.test.ts tests/desktop-chat-entry.test.ts tests/desktop-chat-free-ai-setup.test.ts tests/desktop-free-ai-onboarding.test.ts tests/desktop-retail-ux.test.mjs
```

Expected: only the intended fallback, messaging, and test changes.

**Step 5: Commit final verification touch-ups if needed**

```bash
git add <relevant files>
git commit -m "test: verify macOS Free AI compatibility fallback"
```
