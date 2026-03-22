# Chat-Owned Free AI Auto-Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make free-plan chat automatically handle Free AI setup with user approval, run the managed installer inside the app, and resume the original task once Free AI is ready.

**Architecture:** Keep the existing managed local-AI backend in place and add a chat-owned preflight state in the desktop app. Intercept first-task chat before any LLM intake when Free AI is not ready, generate a deterministic local setup report, reuse the current managed installer commands, and resume the original request only after runtime and model readiness are confirmed.

**Tech Stack:** React 19 desktop UI, TypeScript, Tauri IPC, Rust local-AI manager, Node source-based regression tests, `tsx`, `pnpm`

---

### Task 1: Add Failing Regressions For Chat-Owned Free AI Setup

**Files:**
- Create: `tests/desktop-chat-free-ai-setup.test.ts`
- Modify: `tests/desktop-chat-entry.test.ts`
- Modify: `tests/desktop-free-ai-onboarding.test.ts`
- Modify: `tests/desktop-retail-ux.test.mjs`

**Step 1: Write the failing test**

Create `tests/desktop-chat-free-ai-setup.test.ts` with source assertions that require:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop chat stages setup-before-task when Free AI is not ready', () => {
  const appSource = readFileSync('apps/desktop/src/App.tsx', 'utf8');

  assert.match(appSource, /pendingFreeAiSetup|pendingSetupBeforeTask/);
  assert.match(appSource, /assistantConversationTurn[\s\S]{0,1200}if \(!providerConfigured\)/);
  assert.match(appSource, /Retry Free AI|Cancel this task|Open Settings/);
  assert.match(appSource, /resumeDeferredTaskAfterFreeAiReady|replayDeferredUserTask/);
});
```

Extend the existing tests so they require:

- chat-owned setup approval language on the main path
- progress copy like `Installing local engine` and `Downloading AI model`
- no retail-path mentions of `brew` or manual Ollama install guidance

**Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test tests/desktop-chat-free-ai-setup.test.ts tests/desktop-chat-entry.test.ts tests/desktop-free-ai-onboarding.test.ts tests/desktop-retail-ux.test.mjs
```

Expected: FAIL because the new chat-owned setup state and resume flow do not exist yet.

**Step 3: Write minimal implementation**

Do not implement full behavior yet. Only add the minimal scaffolding needed for the new tests to point at real symbols and copy locations.

**Step 4: Run test to verify it passes**

Run the same command and confirm the new regression coverage is green.

**Step 5: Commit**

```bash
git add tests/desktop-chat-free-ai-setup.test.ts tests/desktop-chat-entry.test.ts tests/desktop-free-ai-onboarding.test.ts tests/desktop-retail-ux.test.mjs
git commit -m "test: cover chat-owned Free AI setup flow"
```

### Task 2: Add Deterministic Setup Report Helpers And Approval Parsing

**Files:**
- Modify: `apps/desktop/src/lib/chatTaskFlow.ts`
- Modify: `apps/desktop/src/lib/gorkhKnowledge.ts`
- Test: `apps/desktop/src/lib/chatTaskFlow.test.mjs`

**Step 1: Write the failing test**

Add helper-level tests for:

```ts
test('assistant setup approval responses parse explicit confirm and cancel answers', () => {
  assert.equal(interpretFreeAiSetupResponse('yes'), 'confirm');
  assert.equal(interpretFreeAiSetupResponse('go ahead'), 'confirm');
  assert.equal(interpretFreeAiSetupResponse('cancel'), 'cancel');
  assert.equal(interpretFreeAiSetupResponse('maybe'), null);
});
```

Add a test that the setup report copy is local and retail-friendly, for example:

```ts
assert.match(report.summary, /Free AI.*required/i);
assert.match(report.summary, /local engine|AI model/i);
assert.doesNotMatch(report.summary, /brew|ollama pull/i);
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test apps/desktop/src/lib/chatTaskFlow.test.mjs
```

Expected: FAIL because the new setup helper functions do not exist.

**Step 3: Write minimal implementation**

In `chatTaskFlow.ts`, add:

- a deterministic setup report builder for the free-plan managed local path
- a parser for setup approval responses, parallel to the existing task-confirmation parser

In `gorkhKnowledge.ts`, add the approved retail copy strings used by the report and failure actions.

**Step 4: Run test to verify it passes**

Run the same command and confirm the helper tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/chatTaskFlow.ts apps/desktop/src/lib/gorkhKnowledge.ts apps/desktop/src/lib/chatTaskFlow.test.mjs
git commit -m "feat: add Free AI setup preflight helpers"
```

### Task 3: Implement Pending Setup State In App Chat Flow

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Possibly modify: `apps/desktop/src/components/ChatOverlay.tsx`
- Test: `tests/desktop-chat-free-ai-setup.test.ts`

**Step 1: Write the failing test**

Add assertions for:

- a dedicated pending setup state in `App.tsx`
- busy handling that covers setup approval/start in addition to task confirmation
- chat interception before `assistantConversationTurn` when Free AI is not ready

Example source assertions:

```ts
assert.match(appSource, /const \[pendingFreeAiSetup, setPendingFreeAiSetup\]/);
assert.match(appSource, /interpretFreeAiSetupResponse/);
assert.match(appSource, /if \(!providerConfigured\)[\s\S]{0,800}setPendingFreeAiSetup/);
assert.match(appSource, /busy=\{assistantConversationBusy \|\| pendingTaskConfirmationBusy \|\| pendingFreeAiSetupBusy/);
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test tests/desktop-chat-free-ai-setup.test.ts
```

Expected: FAIL because the app still jumps directly from “provider not configured” to static onboarding copy.

**Step 3: Write minimal implementation**

In `App.tsx`:

- add local state for pending Free AI setup and setup busy status
- when a new free-plan local request arrives and Free AI is not ready, stage the setup report instead of calling `assistantConversationTurn`
- accept explicit confirm/cancel responses for the pending setup state
- on confirm, call the existing `startLocalAiInstall(...)` path

Keep the existing `pendingTaskConfirmation` flow intact for the post-setup task confirmation stage.

**Step 4: Run test to verify it passes**

Run the same command and confirm the intercept/setup state coverage is green.

**Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx tests/desktop-chat-free-ai-setup.test.ts apps/desktop/src/components/ChatOverlay.tsx
git commit -m "feat: intercept chat with Free AI setup approval"
```

### Task 4: Resume Deferred Task After Free AI Reaches Ready

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/lib/localAi.ts` if a small helper improves readability
- Test: `tests/desktop-chat-free-ai-setup.test.ts`

**Step 1: Write the failing test**

Add source assertions that require:

```ts
assert.match(appSource, /localAiStatus\?\.installStage|localAiInstallProgress\?\.stage/);
assert.match(appSource, /resumeDeferredTaskAfterFreeAiReady|replayDeferredUserTask/);
assert.match(appSource, /assistantConversationRequestIdRef\.current \+= 1/);
```

and a behavioral expectation in the test name that the original request is replayed automatically after setup is ready.

**Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test tests/desktop-chat-free-ai-setup.test.ts
```

Expected: FAIL because the app does not currently store and replay the original request after setup.

**Step 3: Write minimal implementation**

In `App.tsx`:

- preserve the original user request in the pending setup state
- watch for Free AI readiness transitions
- once ready, clear the setup state and replay the stored request into the normal intake path
- ensure this replay only happens once and does not double-send if status refreshes continue

**Step 4: Run test to verify it passes**

Run the same command and confirm the resume path is covered.

**Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx tests/desktop-chat-free-ai-setup.test.ts apps/desktop/src/lib/localAi.ts
git commit -m "feat: resume original task after Free AI setup"
```

### Task 5: Mirror Setup Progress And Failures Back Into Retail Chat Copy

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/FreeAiSetupCard.tsx`
- Modify: `apps/desktop/src/lib/gorkhKnowledge.ts`
- Test: `tests/desktop-free-ai-onboarding.test.ts`
- Test: `tests/desktop-retail-ux.test.mjs`

**Step 1: Write the failing test**

Add assertions requiring:

- chat-visible retail progress labels
- recovery actions `Retry Free AI`, `Cancel this task`, and `Open Settings`
- no retail-path copy that tells the user to use `brew` or manually install Ollama

**Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test tests/desktop-free-ai-onboarding.test.ts tests/desktop-retail-ux.test.mjs
```

Expected: FAIL until the retail copy and recovery actions are wired into the new chat-owned flow.

**Step 3: Write minimal implementation**

Use existing local-AI progress and error state to:

- mirror setup progress into chat
- keep the setup card aligned with the same retail wording
- keep advanced/support details available without making them the main user path

Do not introduce `brew`, `ollama pull`, or package-manager instructions on the main path.

**Step 4: Run test to verify it passes**

Run the same command and confirm retail copy coverage is green.

**Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/components/FreeAiSetupCard.tsx apps/desktop/src/lib/gorkhKnowledge.ts tests/desktop-free-ai-onboarding.test.ts tests/desktop-retail-ux.test.mjs
git commit -m "feat: add retail chat progress and recovery for Free AI setup"
```

### Task 6: Final Verification

**Files:**
- Verify: `apps/desktop/src/App.tsx`
- Verify: `apps/desktop/src/lib/chatTaskFlow.ts`
- Verify: `apps/desktop/src/components/FreeAiSetupCard.tsx`
- Verify: `tests/desktop-chat-free-ai-setup.test.ts`
- Verify: `tests/desktop-chat-entry.test.ts`
- Verify: `tests/desktop-free-ai-onboarding.test.ts`
- Verify: `tests/desktop-retail-ux.test.mjs`

**Step 1: Run focused tests**

Run:

```bash
node --import tsx --test tests/desktop-chat-free-ai-setup.test.ts tests/desktop-chat-entry.test.ts tests/desktop-free-ai-onboarding.test.ts tests/desktop-retail-ux.test.mjs apps/desktop/src/lib/chatTaskFlow.test.mjs
```

Expected: PASS

**Step 2: Run desktop typecheck**

Run:

```bash
pnpm --filter @ai-operator/desktop typecheck
```

Expected: PASS

**Step 3: Sanity-check retail copy**

Confirm the main path still avoids:

```text
brew
winget
ollama pull
manual install
```

unless inside support/advanced details.

**Step 4: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/lib/chatTaskFlow.ts apps/desktop/src/lib/gorkhKnowledge.ts apps/desktop/src/components/FreeAiSetupCard.tsx tests/desktop-chat-free-ai-setup.test.ts tests/desktop-chat-entry.test.ts tests/desktop-free-ai-onboarding.test.ts tests/desktop-retail-ux.test.mjs apps/desktop/src/lib/chatTaskFlow.test.mjs
git commit -m "feat: add chat-owned Free AI setup for free-plan users"
```
