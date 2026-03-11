# Adaptive Local AI Runtime Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an app-managed adaptive local AI foundation so the desktop can detect machine capability, recommend a light/standard/vision tier, and expose a managed runtime lifecycle without requiring users to install Ollama manually.

**Architecture:** Add a new Tauri local-AI manager module that owns hardware profiling, runtime status, install-state bookkeeping, and tier recommendation. Keep Step 1 intentionally narrow: expose the lifecycle skeleton and typed frontend access first, without shipping the actual downloader yet.

**Tech Stack:** Tauri 2, Rust, TypeScript, existing desktop IPC allowlist, Node test runner

---

### Task 1: Design artifacts

**Files:**
- Create: `docs/plans/adaptive-local-ai-runtime.md`
- Create: `docs/plans/2026-03-10-adaptive-local-ai-runtime-implementation.md`

**Step 1: Save the design doc**

- Write the chosen architecture, gap analysis, tiering strategy, packaging implications, and safety model.

**Step 2: Save the implementation plan**

- Record the task-by-task rollout for the local runtime manager.

### Task 2: Step 1 tests first

**Files:**
- Create: `tests/desktop-local-ai-manager.test.mjs`
- Create: `tests/desktop-local-ai-profile.test.ts`
- Modify: `tests/desktop-tauri-commands.test.mjs`

**Step 1: Write failing tests**

- Assert the new Tauri commands exist and are allowlisted.
- Assert a frontend helper surface exists for runtime status, hardware profile, install progress, and recommended tier.
- Assert tier recommendation logic returns conservative defaults for low-end hardware and only recommends vision for capable machines.

**Step 2: Run focused tests to confirm failure**

Run:

```bash
node --test tests/desktop-local-ai-manager.test.mjs
node --import tsx --test tests/desktop-local-ai-profile.test.ts
```

Expected:

- failures because the manager surface and helper do not exist yet

### Task 3: Tauri manager skeleton

**Files:**
- Create: `apps/desktop/src-tauri/src/local_ai.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add minimal Rust types and state**

- Add runtime status payload
- Add install progress payload
- Add hardware profile payload
- Add local tier payload
- Add in-memory manager state

**Step 2: Add minimal capability detection**

- OS
- RAM estimate
- logical CPU count
- best-effort CPU/GPU strings
- available disk estimate

**Step 3: Add tier recommendation logic**

- `light`
- `standard`
- `vision`

**Step 4: Add the command surface**

- `local_ai_status`
- `local_ai_install_start`
- `local_ai_install_progress`
- `local_ai_start`
- `local_ai_stop`
- `local_ai_hardware_profile`
- `local_ai_recommended_tier`

### Task 4: Desktop helper surface

**Files:**
- Create: `apps/desktop/src/lib/localAi.ts`

**Step 1: Add typed invoke helpers**

- read runtime status
- read hardware profile
- read install progress
- request recommended tier
- start/stop runtime
- start install skeleton

**Step 2: Add shared frontend tier helper if needed for tests**

- keep any duplicated threshold logic minimal and documented

### Task 5: Security integration

**Files:**
- Modify: `apps/desktop/src-tauri/permissions/desktop-ipc.toml`
- Modify: `scripts/check-desktop-security.mjs`

**Step 1: Add the new commands to the explicit allowlist**

- keep the command list exact

**Step 2: Keep the desktop security check green**

- verify no unintended plugin or IPC drift

### Task 6: Verification

**Files:**
- No new files

**Step 1: Run focused tests**

Run:

```bash
node --test tests/desktop-local-ai-manager.test.mjs
node --import tsx --test tests/desktop-local-ai-profile.test.ts
node --test tests/desktop-tauri-commands.test.mjs
```

Expected:

- PASS

**Step 2: Run desktop and repo gates**

Run:

```bash
pnpm --filter @ai-operator/desktop typecheck
pnpm --filter @ai-operator/desktop build
pnpm -w build
pnpm -w typecheck
pnpm -w test
pnpm check:desktop:security
pnpm smoke:final
```

Expected:

- PASS, or if `smoke:final` is unaffected but not meaningful for this step, record that explicitly
