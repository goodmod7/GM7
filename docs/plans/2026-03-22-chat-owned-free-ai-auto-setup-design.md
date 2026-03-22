# Chat-Owned Free AI Auto-Setup Design

## Problem

The current desktop app is already intended to be retail-friendly, but the first-task experience still breaks that promise.

Today:

- the desktop can manage a local runtime itself through [`apps/desktop/src-tauri/src/local_ai.rs`](../../apps/desktop/src-tauri/src/local_ai.rs)
- the app can download a managed Ollama runtime directly into the app-managed directory
- the app can adopt an existing compatible local runtime if one already exists
- the app can pull the default Qwen model itself

However, the user-facing flow still has product gaps:

- chat does not own Free AI setup
- a free-plan user can hit a dead-end before the local model is ready
- setup still feels like a separate manual step instead of part of asking GORKH for help
- errors and recovery actions are not yet shaped around a retail, non-technical user

For a retail desktop app, the free-plan path must work without requiring the user to understand Ollama, Homebrew, model pulls, or local-server terminology.

## Goals

- When a free-plan user sends a task and Free AI is not ready, GORKH should intercept the request in chat and explain what must happen first.
- GORKH should ask for explicit approval before downloading or installing anything.
- After approval, GORKH should run the existing managed local-AI setup flow from inside the app.
- GORKH should report setup progress in plain product language.
- Once Free AI is ready, GORKH should automatically continue the original request without asking the user to resend it.
- If setup fails, GORKH should stay in chat, preserve the original request, and offer simple recovery actions.

## Non-Goals

- Replacing the existing managed local-AI backend
- Making Homebrew or any other package manager the primary retail install path
- Requiring free-plan users to choose a paid cloud provider
- Redesigning the entire Settings panel in the same change

## Current Code Reality

### Runtime/install path

The backend already supports retail-style setup:

- [`apps/desktop/src-tauri/src/local_ai.rs`](../../apps/desktop/src-tauri/src/local_ai.rs) provisions the managed runtime
- [`apps/desktop/src-tauri/src/local_ai_manifest.rs`](../../apps/desktop/src-tauri/src/local_ai_manifest.rs) points at platform runtime assets
- `install_start` can:
  - reuse a healthy managed install
  - adopt an existing compatible runtime binary
  - download a managed runtime directly
  - start the runtime
  - pull the default model

This means the app does not need `brew` to work for normal users.

### Frontend/chat path

The missing piece is orchestration:

- [`apps/desktop/src/App.tsx`](../../apps/desktop/src/App.tsx) blocks chat when `providerConfigured` is false
- the main setup surface is still [`apps/desktop/src/components/FreeAiSetupCard.tsx`](../../apps/desktop/src/components/FreeAiSetupCard.tsx)
- chat has a `pendingTaskConfirmation` state for confirmed tasks, but no equivalent `setup-before-task` state
- free-plan retail chat can still feel like “set this up yourself, then come back”

## Approaches Considered

### 1. Keep setup button-owned

Chat explains that Free AI is missing, but the user still has to click `Set Up Free AI` on the card and then retry manually.

Pros:

- smallest implementation diff
- reuses the existing setup card almost unchanged

Cons:

- still feels broken for non-technical users
- forces the user to repeat the original task
- keeps setup outside the assistant conversation

### 2. Chat-owned setup handoff

When Free AI is not ready, chat intercepts the task, generates a local setup report, asks for approval, starts setup, mirrors progress, and resumes the original request automatically after setup completes.

Pros:

- best retail UX
- no manual resend of the original task
- keeps trust because setup still requires approval
- reuses the existing managed runtime backend instead of building a second installer

Cons:

- requires a new pending setup state and stored original request
- requires the app to coordinate setup completion with chat resume

### 3. Silent automatic setup

The app starts installing Free AI immediately when the user sends a task.

Pros:

- lowest friction

Cons:

- wrong trust model for downloading and installing software
- removes user approval for disk/network changes
- harder to explain and support

## Decision

Use approach 2: chat-owned setup handoff with explicit approval.

## Approved User Flow

1. A signed-in free-plan user sends a normal task in chat.
2. If Free AI is not ready, GORKH does not try to call the conversation LLM yet.
3. Instead, the app generates a local setup report in plain language explaining:
   - Free AI is required on the free plan
   - GORKH will check whether a compatible local engine already exists
   - if needed, GORKH will install the local engine and download the default AI model
   - nothing will start until the user approves
4. If the user approves, GORKH starts the managed setup flow inside the app.
5. Chat mirrors setup progress with retail copy:
   - `Checking this device`
   - `Installing local engine`
   - `Downloading AI model`
   - `Starting local engine`
   - `Ready to use`
6. When Free AI reaches `ready`, GORKH automatically resumes the original request and returns to the normal conversation-first flow.
7. If setup fails, GORKH remains in chat and offers:
   - `Retry Free AI`
   - `Cancel this task`
   - `Open Settings`

## Architecture

### 1. New chat-owned setup state

Add a second pre-execution state beside `pendingTaskConfirmation` in [`apps/desktop/src/App.tsx`](../../apps/desktop/src/App.tsx).

That state should store:

- the original user request
- the deterministic setup report shown to the user
- the chosen tier to install
- the current setup status: pending approval, running, failed, or completed

This must be local app state, not model-generated state, because on the free plan the local model may not be available yet.

### 2. Intercept before LLM intake

For the managed local provider path:

- if the task is brand new
- and Free AI is not ready
- and the user is on the free-plan local flow

then chat should stage `setup-before-task` instead of calling `assistantConversationTurn`.

### 3. Resume original request after setup

When local AI transitions to `ready`, the app should automatically replay the stored original request into the normal chat intake path.

This replay should happen only once and only after:

- runtime is reachable
- model is available
- provider is considered configured

### 4. Detection order

The product should reason about setup in this order:

1. managed runtime already healthy
2. existing local AI service already reachable
3. existing compatible local runtime binary already present and adoptable
4. managed runtime download/install/start
5. model download/bootstrap
6. recovery actions if any of the above fail

### 5. Package-manager handling

Homebrew, Winget, and similar tools are not part of the retail primary flow.

Product rules:

- detect existing runtime/service first-class
- use the managed runtime download as the primary install path
- treat package-manager presence only as an advanced diagnostic/support signal
- never tell a normal free-plan user to manually install Ollama unless the managed installer path is unavailable or broken

## Failure Handling

If setup fails:

- keep the original request stored
- keep the user in the same chat
- show plain-language failure copy based on the failure category
- offer `Retry Free AI`, `Cancel this task`, and `Open Settings`

If the user retries and setup succeeds:

- automatically resume the stored request

If the user cancels:

- clear the stored request and return to idle chat

## Retail Copy Rules

Main path copy should say:

- `Free AI`
- `local engine`
- `AI model`
- `repair`
- `retry`

Main path copy should not say:

- `brew`
- `winget`
- `ollama pull`
- raw binary paths

Low-level details may still appear in advanced/support surfaces such as:

- support details in the setup card
- diagnostics export
- advanced settings

## Testing Strategy

Add or update regressions for:

- chat intercepts first task when Free AI is not ready
- chat asks for setup approval before any LLM intake call
- approving setup starts the existing managed setup path
- progress appears in chat in retail language
- successful setup resumes the original request automatically
- failed setup preserves the original request and offers recovery actions
- free-plan path does not suggest paid providers as the main solution
- retail surfaces avoid `brew` and other manual-install guidance on the main path

## Expected Files

- [`apps/desktop/src/App.tsx`](../../apps/desktop/src/App.tsx)
- [`apps/desktop/src/lib/chatTaskFlow.ts`](../../apps/desktop/src/lib/chatTaskFlow.ts)
- [`apps/desktop/src/lib/localAi.ts`](../../apps/desktop/src/lib/localAi.ts)
- [`apps/desktop/src/lib/gorkhKnowledge.ts`](../../apps/desktop/src/lib/gorkhKnowledge.ts)
- [`apps/desktop/src/components/FreeAiSetupCard.tsx`](../../apps/desktop/src/components/FreeAiSetupCard.tsx)
- [`tests/desktop-chat-entry.test.ts`](../../tests/desktop-chat-entry.test.ts)
- [`tests/desktop-free-ai-onboarding.test.ts`](../../tests/desktop-free-ai-onboarding.test.ts)
- [`tests/desktop-retail-ux.test.mjs`](../../tests/desktop-retail-ux.test.mjs)
- one new focused chat/setup regression under [`tests`](../../tests)
