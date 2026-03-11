# Chat-First Desktop Product Design

## Goal

Turn the desktop app into a normal assistant product for retail users without throwing away the current secure run, approval, device, and desktop-auth foundations.

The desktop must feel like:

- sign in
- see one assistant
- type naturally
- the assistant starts working

The desktop must not feel like:

- create a run
- choose a run mode
- manage pairing
- operate an admin console

## Non-Goals

- Do not replace the existing `Run` model in this phase.
- Do not make the current advanced-agent runtime the only engine yet.
- Do not remove web admin/debug fallback paths yet.
- Do not weaken approvals, screenshot, key-storage, or logging rules.

## A. Chat-First Desktop UX

The signed-in desktop home screen becomes a single assistant surface.

Primary retail elements:

- assistant message thread
- one main composer
- current task progress
- pending approvals
- provider status
- setup blockers only when they block real work

Secondary elements:

- technical run details
- raw run history
- device/account management
- debug/admin controls

Those secondary elements move into a collapsed details area, settings, or a clearly labeled debug/admin view inside the desktop app. They remain available for troubleshooting but are no longer the first thing a retail user sees.

Signed-out UX remains the current browser-based desktop sign-in flow.

Signed-in UX starts with a prominent assistant thread. The empty state should read like a consumer assistant, not an operator console. Example prompts can still be shown, but they should be expressed as natural requests rather than task/run instructions.

## B. Mapping Natural Chat to the Existing Run Model

The product keeps the existing backend `Run` model and approval flow, but the desktop hides it behind a chat shell.

Retail interaction model:

- the first user message silently creates a run if no active run exists
- follow-up user messages attach to the active run
- when the active run is terminal (`done`, `failed`, `canceled`), the next user message starts a new hidden run

Internal mapping:

- initial user message becomes the hidden run goal
- the run is created through the existing desktop-authenticated run path
- the desktop immediately binds the assistant thread to that run
- run state, proposals, logs, and approvals continue to flow through the existing websocket/run plumbing

Desktop-side orchestration rules:

- if an active run exists in `queued`, `running`, or `waiting_for_user`, reuse it
- otherwise create a new desktop run in the default assistant mode
- after the run exists, attach the user message to the run chat stream

This keeps the current persistence, SSE/web observability, approvals, and audit model intact while removing run creation from the retail mental model.

## C. Hiding or Demoting Run/Admin Complexity

Retail users should not see:

- `Create Task`
- `Start Task`
- explicit run mode selection
- `Active Run`
- `Recent Tasks`
- raw device/account/admin panels

Those concepts remain internally and in secondary surfaces.

Desktop demotion plan:

- replace the current primary task composer with the assistant thread
- move technical run details into a collapsible `Technical details` or `Debug` section
- move device/account management into settings or a secondary view
- keep approvals visible because they are part of the safety contract
- show progress in assistant language such as `Working`, `Waiting for approval`, `Need input`, `Done`

Web demotion remains as already implemented:

- main dashboard = account/billing/downloads/devices
- legacy pairing/run creation = admin/debug only

## D. Provider Architecture in the Real Main Flow

The main assistant flow must stop depending on one ad hoc provider path while the advanced-agent stack lives separately.

The desktop needs one provider source of truth for the retail assistant:

- provider id
- label
- free/paid classification
- availability
- local setup requirements
- whether an API key is required
- approximate cost info

Short-term implementation direction:

- keep the existing AI Assist execution loop as the live engine for Step 1 and Step 2
- move provider selection for the retail assistant onto a real capability list backed by Tauri commands, not mock TypeScript data
- use one desktop settings model for provider choice and provider credentials

Long-term direction:

- the main assistant shell depends on an engine interface rather than directly on the current AI Assist implementation
- the advanced-agent engine is moved behind that same interface once it is actually production-ready

## E. Making Local Qwen/Ollama the Default Free Path

The primary default provider for a fresh desktop install becomes local Qwen via Ollama.

Product behavior:

- default provider = native local Qwen/Ollama
- if Ollama or the required model is unavailable, the desktop shows actionable setup guidance
- local free remains the recommended default
- cloud providers are optional upgrades, not the assumed baseline

Implementation direction:

- make native local Qwen/Ollama a first-class provider in the real desktop assistant flow
- keep generic `openai_compat` as a secondary advanced local option, not the main free story
- remove the current mismatch where the UI implies a local provider needs no key while the runtime always tries to read one

Expected local setup guidance:

- Ollama not running
- required model missing
- how to install/pull the model
- retry action from desktop

## F. Integrating Paid Providers Cleanly

Paid providers should be available from the same assistant settings surface as the local provider.

Target paid providers:

- OpenAI
- Claude
- DeepSeek
- MiniMax
- Kimi

Implementation rule:

- only expose providers in the primary retail UI when there is a real tested runtime path behind them

Provider integration model:

- API keys stored only in the desktop keychain
- provider test/check happens locally
- backend never stores or proxies user LLM keys
- if a provider is OpenAI-compatible in practice, that can be implemented through a compatible adapter, but the desktop UI must label it honestly

Routing/fallback:

- optional
- must be user-controlled
- if `ask before paid` is enabled, switching from free local to paid requires clear user consent
- cost estimates can be approximate, but must be conservative and labeled as estimates

## G. Unifying the Advanced Agent into the Main Assistant

The product currently has two mental models:

- AI Assist
- Advanced Agent / AI Engineering System

That duplication must go away in the retail product.

Unification strategy:

- the chat-first shell becomes the only retail assistant surface
- the current AI Assist loop remains the live engine initially
- the advanced-agent planner/vision/provider work is integrated behind the same shell in later steps
- separate advanced-agent buttons and engineering-system surfaces are removed or hidden from retail UX once equivalent capability exists in the main assistant

Important constraint:

- do not claim the advanced-agent runtime is the main engine until the packaged runtime actually supports planning, routing, vision, execution, and approval end-to-end

## H. Migration Strategy

Phase 1:

- convert the main desktop surface to a hidden-run chat shell
- first chat message creates or resumes a run
- remove explicit run creation from the primary retail surface

Phase 2:

- make local Qwen/Ollama the real default provider in the main path
- fix local provider runtime consistency

Phase 3:

- add real paid-provider support to the same main assistant path
- provider UI becomes runtime-backed, not mock-backed

Phase 4:

- move advanced planner/vision/provider machinery behind the main assistant shell
- retire duplicate retail-facing agent surfaces

Phase 5:

- simplify remaining desktop UI so it reads as assistant-first
- keep debug/admin surfaces secondary

Migration safety:

- existing backend endpoints remain during transition
- web admin/legacy paths remain as fallback
- existing run data remains valid because the desktop still uses the same run model

## I. Safety Model Preservation

The current safety rules remain mandatory.

Preserved rules:

- local approvals remain required for privileged actions and tools unless existing explicitly safe behavior is already audited
- screenshots are captured in memory only and are not persisted
- user LLM keys stay local in desktop keychain storage
- server-side logs must not include typed text, file contents, tool payload contents, terminal args, tokens, or API keys

Implementation implications:

- hidden-run chat shell changes UX, not trust boundaries
- run creation still goes through the same audited backend/device ownership checks
- action/tool approvals still flow through the same local approval controller
- provider settings stay local to the desktop
- any provider capability/status APIs exposed to the frontend must return metadata only, never secrets

## Recommended Implementation Order

1. Make chat the true entry point while keeping hidden runs under the hood.
2. Make local Qwen/Ollama the default free provider in the real main flow.
3. Add real paid-provider support to the same flow.
4. Unify the advanced-agent engine behind the main assistant shell.
5. Finish retail UX simplification and keep web secondary.
