# Free AI Hosted Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep Free AI local-first, fix managed-runtime ownership/readiness bugs, and add a hosted vision-capable fallback with free-plan limits enforced by the API.

**Architecture:** The desktop keeps `native_qwen_ollama` as the user-facing provider but gains internal routing between local and hosted fallback execution paths. The API exposes authenticated `/desktop/free-ai/*` endpoints backed by a hosted OpenAI-compatible model and persists daily usage counters. Local-runtime ownership detection is tightened so managed installs are not misclassified as external after process-state loss or app restart.

**Tech Stack:** Tauri desktop app, Rust local runtime manager, TypeScript React desktop UI, Fastify API, Prisma/Postgres, node:test, tsx

---

### Task 1: Lock the local runtime classification bug with failing tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/local_ai.rs`
- Create: `tests/desktop-local-ai-runtime-ownership.test.mjs`

**Step 1: Write the failing test**

Add test coverage for the behavior contract:

- managed metadata + running service + no child handle => treat as managed for compatibility recovery
- no managed metadata + running service => treat as external

Use a JS truth test for source inspection and a Rust unit test for pure function behavior if a helper is extracted.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-local-ai-runtime-ownership.test.mjs`

Expected: FAIL because the current code still uses `running && !managed_child_running` as the external-service test.

**Step 3: Write minimal implementation**

Refactor `apps/desktop/src-tauri/src/local_ai.rs`:

- extract a helper that derives ownership/classification from:
  - running
  - child running
  - metadata/runtime source
- use that helper in both `runtime_status` and `compatibility_disposition`

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-local-ai-runtime-ownership.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/desktop-local-ai-runtime-ownership.test.mjs apps/desktop/src-tauri/src/local_ai.rs
git commit -m "test: cover local AI managed runtime ownership classification"
```

### Task 2: Add failing tests for hosted fallback policy and desktop account snapshot

**Files:**
- Modify: `apps/api/src/lib/desktop-account.ts`
- Create: `tests/api-desktop-free-ai-policy.test.ts`
- Modify: `apps/desktop/src/lib/localPlan.ts`
- Create: `tests/desktop-hosted-free-ai-policy.test.ts`

**Step 1: Write the failing tests**

Cover:

- desktop account snapshot exposes hosted fallback plan info
- free plan gets a daily hosted fallback limit
- plus plan gets unlimited hosted fallback
- desktop helper can read hosted fallback policy cleanly

**Step 2: Run tests to verify they fail**

Run:

```bash
node --import tsx --test tests/api-desktop-free-ai-policy.test.ts tests/desktop-hosted-free-ai-policy.test.ts
```

Expected: FAIL because hosted fallback policy does not exist yet.

**Step 3: Write minimal implementation**

Add hosted fallback billing fields to the desktop account snapshot and desktop-side policy helpers without changing behavior anywhere else yet.

**Step 4: Run tests to verify they pass**

Run:

```bash
node --import tsx --test tests/api-desktop-free-ai-policy.test.ts tests/desktop-hosted-free-ai-policy.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/lib/desktop-account.ts apps/desktop/src/lib/localPlan.ts tests/api-desktop-free-ai-policy.test.ts tests/desktop-hosted-free-ai-policy.test.ts
git commit -m "feat: expose hosted Free AI fallback policy"
```

### Task 3: Add failing API tests for hosted fallback quota and auth

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/repos/free-ai-usage.ts`
- Create: `tests/api-desktop-free-ai-fallback.test.ts`
- Modify: `apps/api/src/index.ts`

**Step 1: Write the failing tests**

Cover:

- desktop bearer session required
- fallback status route returns remaining quota
- free-plan requests are rejected when quota is exhausted
- plus-plan requests are allowed

Start with a status route and one text-generation proxy route.

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/api-desktop-free-ai-fallback.test.ts`

Expected: FAIL because routes, model, and repo do not exist.

**Step 3: Write minimal implementation**

- add a Prisma model for daily hosted fallback usage
- add repo helpers for read/increment
- add API config/env flags for hosted fallback
- add `/desktop/free-ai/status`
- add `/desktop/free-ai/chat` with auth + quota enforcement

Use a stubbed provider call helper first so tests can run without real GPU infra.

**Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/api-desktop-free-ai-fallback.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/src/repos/free-ai-usage.ts apps/api/src/index.ts apps/api/src/config.ts tests/api-desktop-free-ai-fallback.test.ts
git commit -m "feat: add hosted Free AI fallback API with quotas"
```

### Task 4: Add failing desktop tests for local-first fallback routing

**Files:**
- Create: `apps/desktop/src/lib/freeAiRouting.ts`
- Create: `tests/desktop-free-ai-fallback-routing.test.ts`
- Modify: `apps/desktop/src/lib/localAi.ts`

**Step 1: Write the failing tests**

Cover:

- healthy local generation => local path selected
- local generation failure => hosted fallback selected when available
- vision task with local vision unavailable => hosted fallback selected
- no hosted quota => route fails with clear reason

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/desktop-free-ai-fallback-routing.test.ts`

Expected: FAIL because routing helper does not exist.

**Step 3: Write minimal implementation**

Add a pure desktop routing helper that accepts:

- local status/readiness
- task needs vision
- hosted fallback status/quota

Return:

- `local`
- `hosted_fallback`
- `blocked`

**Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/desktop-free-ai-fallback-routing.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/freeAiRouting.ts apps/desktop/src/lib/localAi.ts tests/desktop-free-ai-fallback-routing.test.ts
git commit -m "feat: add Free AI local-first fallback routing"
```

### Task 5: Add failing desktop API tests for hosted fallback client helpers

**Files:**
- Create: `apps/desktop/src/lib/freeAiFallbackApi.ts`
- Create: `tests/desktop-free-ai-fallback-api.test.ts`
- Modify: `apps/desktop/src/lib/desktopTasks.ts`

**Step 1: Write the failing tests**

Cover:

- fallback status fetch uses desktop bearer auth
- fallback chat request posts to `/desktop/free-ai/chat`
- fallback generate request posts screenshots when present

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/desktop-free-ai-fallback-api.test.ts`

Expected: FAIL because helpers do not exist.

**Step 3: Write minimal implementation**

Build typed client helpers on top of `fetchDesktopApiJson`.

**Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/desktop-free-ai-fallback-api.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/freeAiFallbackApi.ts apps/desktop/src/lib/desktopTasks.ts tests/desktop-free-ai-fallback-api.test.ts
git commit -m "feat: add desktop hosted Free AI fallback client"
```

### Task 6: Add failing tests for chat intake fallback

**Files:**
- Modify: `apps/desktop/src/lib/assistantConversation.ts`
- Create: `tests/desktop-free-ai-chat-fallback.test.ts`
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Write the failing tests**

Cover:

- local conversation path failure with hosted fallback available => chat still returns a reply
- fallback exhaustion => user sees a quota-specific message
- local compatibility/external-service failure can still fall back to hosted

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/desktop-free-ai-chat-fallback.test.ts`

Expected: FAIL because chat only knows the local Tauri path today.

**Step 3: Write minimal implementation**

- teach the conversation helper and `App.tsx` to:
  - try local Free AI first,
  - invoke the hosted fallback API when needed,
  - preserve conversation-first behavior and clear user messaging.

**Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/desktop-free-ai-chat-fallback.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/assistantConversation.ts apps/desktop/src/App.tsx tests/desktop-free-ai-chat-fallback.test.ts
git commit -m "feat: add hosted Free AI fallback for chat"
```

### Task 7: Add failing tests for confirmed-task and vision fallback

**Files:**
- Modify: `apps/desktop/src/lib/assistantEngine.ts`
- Modify: `apps/desktop/src/lib/advancedAgent.ts`
- Modify: `apps/desktop/src-tauri/src/agent/providers/local_compat.rs`
- Create: `tests/desktop-free-ai-task-fallback.test.ts`

**Step 1: Write the failing tests**

Cover:

- task startup chooses hosted fallback when local vision is unavailable
- advanced agent treats hosted fallback as vision-capable when configured
- screenshots are sent to the hosted fallback path

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/desktop-free-ai-task-fallback.test.ts`

Expected: FAIL because the agent path currently hardcodes local OpenAI-compatible vision support as false.

**Step 3: Write minimal implementation**

- add explicit hosted fallback provider mapping in desktop runtime selection
- allow the advanced agent’s OpenAI-compatible path to advertise vision when the endpoint is the GM7 hosted fallback
- route screenshot tasks to the hosted API-backed path

**Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/desktop-free-ai-task-fallback.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/assistantEngine.ts apps/desktop/src/lib/advancedAgent.ts apps/desktop/src-tauri/src/agent/providers/local_compat.rs tests/desktop-free-ai-task-fallback.test.ts
git commit -m "feat: support hosted Free AI fallback for vision tasks"
```

### Task 8: Surface fallback status in the desktop UI

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/FreeAiSetupCard.tsx`
- Modify: `apps/desktop/src/lib/gorkhContext.ts`
- Create: `tests/desktop-free-ai-fallback-ui.test.mjs`

**Step 1: Write the failing test**

Cover:

- UI mentions hosted fallback availability and remaining quota
- UI distinguishes local mode from hosted fallback mode
- support details avoid raw backend names in retail copy

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/desktop-free-ai-fallback-ui.test.mjs`

Expected: FAIL because the UI does not expose fallback state yet.

**Step 3: Write minimal implementation**

Add a compact status surface in the Free AI card and support details.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/desktop-free-ai-fallback-ui.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/components/FreeAiSetupCard.tsx apps/desktop/src/lib/gorkhContext.ts tests/desktop-free-ai-fallback-ui.test.mjs
git commit -m "feat: surface Free AI hosted fallback status"
```

### Task 9: End-to-end verification

**Files:**
- Modify as needed based on verification failures only

**Step 1: Run focused desktop and API tests**

Run:

```bash
node --import tsx --test \
  tests/desktop-local-ai-runtime-ownership.test.mjs \
  tests/api-desktop-free-ai-policy.test.ts \
  tests/desktop-hosted-free-ai-policy.test.ts \
  tests/api-desktop-free-ai-fallback.test.ts \
  tests/desktop-free-ai-fallback-routing.test.ts \
  tests/desktop-free-ai-fallback-api.test.ts \
  tests/desktop-free-ai-chat-fallback.test.ts \
  tests/desktop-free-ai-task-fallback.test.ts \
  tests/desktop-free-ai-fallback-ui.test.mjs
```

Expected: PASS

**Step 2: Run existing nearby regression coverage**

Run:

```bash
node --import tsx --test \
  tests/desktop-local-ai-install-runtime.test.mjs \
  tests/desktop-local-ai-manager.test.mjs \
  tests/desktop-conversation-intake.test.mjs \
  tests/desktop-assistant-engine.test.ts \
  tests/api-desktop-runs.test.mjs \
  tests/api-desktop-session.test.mjs \
  tests/api-subscription.test.mjs
```

Expected: PASS

**Step 3: Run type-oriented verification**

Run:

```bash
pnpm --filter @ai-operator/api typecheck
pnpm --filter @ai-operator/desktop typecheck
```

Expected: PASS

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add Free AI hosted fallback and local runtime recovery"
```

Plan complete and saved to `docs/plans/2026-03-23-free-ai-hosted-fallback.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
