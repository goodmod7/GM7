# Chat-First Desktop Product Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the desktop into a chat-first assistant product while reusing the existing run, approval, device, and desktop-auth foundations.

**Architecture:** Keep the current `Run` model and approval system, but hide them behind a desktop chat shell. Implement the migration in small steps: first make chat create/resume hidden runs, then make local Qwen/Ollama the default provider in the real flow, then bring paid providers and the advanced-agent stack under the same assistant shell.

**Tech Stack:** React, Tauri, TypeScript, Rust, Fastify, shared protocol types, node:test, pnpm/turbo.

---

### Task 1: Hidden-Run Chat Entry

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/lib/chatTaskFlow.ts`
- Modify: `apps/desktop/src/components/ChatOverlay.tsx` or replace with a main assistant-thread component
- Test: `tests/desktop-chat-entry.test.mjs`
- Test: `tests/desktop-task-surface.test.mjs`

**Step 1: Write the failing tests**

- Add a focused test that proves the desktop chat path creates or resumes a run before sending the first user message.
- Update the desktop surface test to stop expecting `Create Task` and instead expect a retail assistant-first shell.

**Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/desktop-chat-entry.test.mjs tests/desktop-task-surface.test.mjs
```

Expected:

- the new chat-entry test fails because the helper/UI does not exist yet
- the task-surface test fails because the current desktop still exposes task/run-first UX

**Step 3: Write the minimal implementation**

- Add a small desktop helper that:
  - reuses an active run when possible
  - otherwise creates a hidden desktop run through `/desktop/runs`
  - returns the run to the chat send path
- Make the main assistant composer call that helper before sending the message
- Remove or demote the retail-facing `Create Task` panel from the primary surface
- Keep approvals and progress visible, but move technical run/admin details to a secondary area

**Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test tests/desktop-chat-entry.test.mjs tests/desktop-task-surface.test.mjs
```

Expected:

- both tests pass

**Step 5: Run Step 1 desktop verification**

Run:

```bash
pnpm --filter @ai-operator/desktop build
pnpm --filter @ai-operator/desktop typecheck
```

Expected:

- desktop build and typecheck pass

### Task 2: Local Qwen/Ollama Default

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/lib/aiAssist.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/llm/mod.rs`
- Add or adapt: native Ollama-backed provider bridge in the real main assistant path
- Test: `tests/desktop-provider-default.test.mjs`
- Test: `tests/desktop-local-provider-runtime.test.ts`

**Steps:**

1. Write failing tests for local Qwen/Ollama as default.
2. Write failing tests for the no-key local provider path.
3. Make native local Qwen/Ollama a real first-class provider in the main assistant flow.
4. Fix the current key/no-key mismatch.
5. Add actionable local setup errors.
6. Verify focused tests, then desktop build/typecheck.

### Task 3: Real Provider Registry for Main Flow

**Files:**
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/lib/advancedAgent.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/agent/providers/mod.rs`
- Test: `tests/desktop-provider-registry.test.mjs`

**Steps:**

1. Write failing tests that the desktop provider UI reflects real runtime support rather than mock data.
2. Replace mock provider listing with runtime-backed capability data.
3. Keep only actually supported providers in the primary retail UI.
4. Verify focused tests.

### Task 4: Paid Providers in Main Assistant Flow

**Files:**
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/lib/aiAssist.ts`
- Modify: `apps/desktop/src-tauri/src/llm/mod.rs`
- Add/modify provider adapters under `apps/desktop/src-tauri/src/llm/` or a unified provider layer
- Test: `tests/desktop-paid-providers.test.mjs`

**Steps:**

1. Write failing tests for OpenAI and Claude in the real main flow.
2. Add DeepSeek, MiniMax, and Kimi only if there is a real compatible runtime path.
3. Add honest provider labels, cost hints, and paid warnings.
4. Verify focused tests, then desktop build/typecheck.

### Task 5: Assistant Engine Unification

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Add: `apps/desktop/src/lib/assistantEngine.ts`
- Modify: `apps/desktop/src/lib/aiAssist.ts`
- Modify: `apps/desktop/src-tauri/src/agent/mod.rs`
- Test: `tests/desktop-assistant-engine.test.ts`

**Steps:**

1. Write failing tests for a single assistant engine interface used by the retail chat shell.
2. Make current AI Assist implement that interface first.
3. Move advanced-agent integration behind the same interface without making it the sole engine until runtime support is real.
4. Verify focused tests.

### Task 6: Retail UX Simplification

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/RunPanel.tsx`
- Modify/create: assistant progress and blocker components
- Test: `tests/desktop-retail-ux.test.mjs`

**Steps:**

1. Write failing tests for assistant-first UI, with run/admin concepts demoted.
2. Simplify copy and layout to show assistant chat, progress, approvals, provider status, and blocker prompts only when relevant.
3. Move technical views behind a secondary debug/details affordance.
4. Verify focused tests.

### Task 7: Web Secondary Posture Confirmation

**Files:**
- Modify only if needed: `apps/web/app/dashboard/page.tsx`
- Modify only if needed: `apps/web/app/dashboard/legacy/page.tsx`
- Test: `tests/web-dashboard-desktop-first.test.mjs`

**Steps:**

1. Write a failing test only if Step 1-6 regress desktop-first posture.
2. Keep web for account/billing/downloads/admin only.
3. Verify focused tests.

### Task 8: Final Verification

**Step 1: Run focused tests for the last changed task**

Run the task-specific test files.

**Step 2: Run repo-wide gates**

Run:

```bash
pnpm -w build
pnpm -w typecheck
pnpm -w test
pnpm check:desktop:security
pnpm smoke:final
```

Expected:

- all gates pass without security regressions
