# Investor Free AI Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the desktop investor build present `Free AI` as the only no-key free option while keeping the Render-hosted fallback hidden and testable.

**Architecture:** Keep Modal credentials exclusively on Render. The desktop app will keep local-first `Free AI`, hide the generic OpenAI-compatible provider from the launch menu, and use the existing authenticated Render fallback for settings testing and chat recovery when local runtime failures are fallback-worthy.

**Tech Stack:** React/TypeScript desktop UI, Tauri invoke bridge, Rust reqwest OpenAI-compatible client, Node test runner

---

### Task 1: Lock the visible provider list to the investor-safe set

**Files:**
- Modify: `apps/desktop/src/lib/llmConfig.ts`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`
- Test: `tests/desktop-paid-provider-support.test.ts`

**Step 1: Write the failing test**

Update `tests/desktop-paid-provider-support.test.ts` so the launch-facing providers are only `native_qwen_ollama`, `openai`, and `claude`, and the settings copy no longer advertises `Custom OpenAI-compatible`.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-paid-provider-support.test.ts`

**Step 3: Write minimal implementation**

Remove `openai_compat` from `LAUNCH_PROVIDER_ORDER` and update the settings explanatory copy to match the investor-safe provider list while keeping the compatibility-provider note for existing setups.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-paid-provider-support.test.ts`

**Step 5: Commit**

```bash
git add tests/desktop-paid-provider-support.test.ts apps/desktop/src/lib/llmConfig.ts apps/desktop/src/components/SettingsPanel.tsx
git commit -m "fix: hide compatibility provider from launch settings"
```

### Task 2: Make Free AI settings testing use the hidden hosted fallback

**Files:**
- Modify: `apps/desktop/src/lib/freeAiFallback.ts`
- Modify: `apps/desktop/src/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `tests/desktop-free-ai-hosted-fallback.test.ts`

**Step 1: Write the failing test**

Extend `tests/desktop-free-ai-hosted-fallback.test.ts` to cover a hosted fallback test helper and ensure `SettingsPanel.tsx` invokes that helper for `native_qwen_ollama`.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-free-ai-hosted-fallback.test.ts`

**Step 3: Write minimal implementation**

Add a small authenticated hosted-fallback test helper in `freeAiFallback.ts`, pass signed-in runtime props into `SettingsPanel`, and make Free AI test local first then try the hidden Render fallback if the local error qualifies.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-free-ai-hosted-fallback.test.ts`

**Step 5: Commit**

```bash
git add tests/desktop-free-ai-hosted-fallback.test.ts apps/desktop/src/lib/freeAiFallback.ts apps/desktop/src/components/SettingsPanel.tsx apps/desktop/src/App.tsx
git commit -m "fix: test free ai through hosted fallback"
```

### Task 3: Fix hosted fallback error wording

**Files:**
- Modify: `apps/desktop/src-tauri/src/llm/openai_compat.rs`
- Test: `tests/desktop-tauri-error-handling.test.ts`

**Step 1: Write the failing test**

Update `tests/desktop-tauri-error-handling.test.ts` to assert that hosted fallback failures use hosted wording instead of `local server` wording.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-tauri-error-handling.test.ts`

**Step 3: Write minimal implementation**

Teach `openai_compat.rs` to detect hosted Free AI fallback URLs and emit hosted-specific connection, auth, and 404 messages.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-tauri-error-handling.test.ts`

**Step 5: Commit**

```bash
git add tests/desktop-tauri-error-handling.test.ts apps/desktop/src-tauri/src/llm/openai_compat.rs
git commit -m "fix: clarify hosted free ai fallback errors"
```

### Task 4: Verify the full desktop/API regression set

**Files:**
- Test: `tests/desktop-paid-provider-support.test.ts`
- Test: `tests/desktop-free-ai-hosted-fallback.test.ts`
- Test: `tests/desktop-tauri-error-handling.test.ts`
- Test: `tests/desktop-provider-default.test.ts`
- Test: `tests/api-desktop-free-ai-fallback.test.mjs`

**Step 1: Run focused regression tests**

Run:

```bash
node --import tsx --test tests/desktop-paid-provider-support.test.ts tests/desktop-free-ai-hosted-fallback.test.ts tests/desktop-tauri-error-handling.test.ts tests/desktop-provider-default.test.ts tests/api-desktop-free-ai-fallback.test.mjs
```

Expected: PASS

**Step 2: Run the full suite**

Run:

```bash
pnpm test
```

Expected: PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "fix: harden investor free ai desktop flow"
```
