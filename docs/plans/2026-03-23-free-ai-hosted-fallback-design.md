# Free AI Hosted Fallback Design

**Date:** 2026-03-23

## Problem

The current desktop `Free AI` experience has two structural weaknesses:

1. local inference depends on an Ollama runtime that may fail on user machines, especially on macOS Metal,
2. the product has no zero-install fallback when local inference is unavailable.

Today, a user can have a running local service on `127.0.0.1:11434` that passes a shallow health check but still crashes during actual generation. The desktop then surfaces a compatibility or connectivity error and the assistant becomes unusable.

## Goals

- Keep `Free AI` local-first when local inference is healthy.
- Add a hosted fallback so free-plan users can still use the assistant when local inference fails.
- Support both text and screenshot-driven tasks in the hosted fallback.
- Reuse existing desktop auth and billing state rather than inventing a parallel trust model.
- Enforce fallback quotas server-side so free-plan limits are real and multi-device safe.
- Fix the current local ownership bug so app-managed Ollama is not misclassified as external after process-state loss or restart.

## Non-Goals

- Replacing the local Free AI path with hosted inference.
- Building a generic public LLM gateway for arbitrary third-party use.
- Solving upstream Ollama or Metal issues in this repo.
- Adding a brand-new billing system beyond the existing desktop account model.

## Chosen Architecture

### 1. Local-first, hosted-second routing

`Free AI` remains a single user-facing provider. Internally it gains two execution modes:

- `local`: current app-managed or adopted local runtime,
- `hosted_fallback`: an API-backed OpenAI-compatible model served by the GM7 backend.

Desktop attempts local first. If local readiness checks fail, local generation fails, or local vision is unavailable for a task that requires screenshots, the desktop may fall back to hosted inference if:

- the desktop is signed in,
- the API runtime is reachable,
- the user has remaining hosted-fallback quota.

The desktop should surface this as `Free AI fallback active` rather than switching the user to a visibly different provider.

### 2. Fix local runtime ownership classification

The current code treats any running service on `127.0.0.1:11434` as external unless the current process still owns a live child handle. That is too strict. The app already persists managed-runtime metadata and binary location, so ownership should be derived from persisted state as well as the live child process.

New rule:

- if managed metadata exists and the runtime source is `managed` or `existing_install`, treat the runtime as app-managed for compatibility recovery and UI explanation,
- only classify as `external_service` when there is a running service with no managed metadata/source indicating app ownership.

This lets GORKH re-enter compatibility mode after restart instead of telling the user to fix Ollama manually when the app actually owns the runtime.

### 3. Generation-level local readiness

Port-open and `/api/tags` are not enough to prove that local inference is usable. Desktop needs a stronger readiness concept:

- `runtime_running`: current low-level service state,
- `generation_ready`: a higher-level state proven by a lightweight generation/model-health probe,
- `vision_ready`: whether the currently selected execution path can handle image tasks.

The UI and routing logic should use generation-level readiness when deciding whether `Free AI` is usable for chat and tasks.

### 4. Hosted fallback served by the API

The API will expose authenticated desktop-only proxy endpoints for the hosted fallback. The backend provider behind those endpoints should be OpenAI-compatible and vision-capable. The best initial fit is vLLM because:

- it provides an OpenAI-compatible server,
- it supports multimodal models including `Qwen/Qwen2.5-VL-3B-Instruct`,
- it aligns with this repo’s existing `openai_compat` abstractions.

The GM7 API becomes the only server the desktop talks to for hosted fallback. The desktop should never talk directly to the hosted inference server.

### 5. Server-side quotas for hosted fallback

Free-plan local task limits are currently client-side only. Hosted fallback must be enforced server-side because it consumes shared infrastructure.

Initial policy:

- Plus: unlimited hosted fallback usage.
- Free: daily hosted fallback task limit equal to the current free local task limit by default.
- Vision tasks count against the same hosted fallback quota instead of needing a separate plan gate.

The desktop account snapshot should expose hosted-fallback policy and remaining quota so UI copy can explain why fallback is available or exhausted.

## Backend Design

### Auth

Reuse the existing desktop bearer device token used for `/desktop/me` and `/desktop/runs`. Hosted fallback endpoints should require the same desktop device session and verify device ownership exactly the same way.

### New API surface

Add desktop-authenticated endpoints under `/desktop/free-ai/*`:

- `GET /desktop/free-ai/status`
  - returns hosted fallback policy, remaining quota, and whether the backend fallback is configured/reachable.
- `POST /desktop/free-ai/chat`
  - handles conversation/intake fallback for text-only or image-free chat.
- `POST /desktop/free-ai/generate`
  - handles proposal-style or task-execution fallback requests, including optional screenshot payloads.

Internally, these routes proxy to a configured hosted OpenAI-compatible backend with a server-held API key if needed. They also:

- meter usage,
- redact or avoid logging raw prompt/image payloads,
- normalize backend failures into desktop-friendly errors.

### Quota persistence

Add a small persisted usage table keyed by user and day. This avoids:

- per-device duplication,
- localStorage-only enforcement,
- quota resets on desktop reinstall.

The server should reserve quota when a hosted fallback request starts and commit usage only for accepted requests, with a simple daily counter model first.

### Config

Add API env vars for the hosted fallback provider:

- enable/disable hosted fallback,
- provider base URL,
- provider model for text,
- provider vision model if distinct,
- optional API key.

If these are absent, desktop fallback stays unavailable and local-only behavior remains intact.

## Desktop Design

### Provider model

Keep `native_qwen_ollama` as the user-facing default provider. Do not expose hosted fallback as a separate settings provider in the first iteration.

Instead, add routing helpers that produce an `effective Free AI execution path`:

- `local`,
- `hosted_fallback`,
- `unavailable`.

### Chat / intake

When conversation-first chat starts:

1. try local if generation-ready,
2. on recognized local failure, try hosted fallback if allowed,
3. if fallback succeeds, continue the conversation normally and surface a small fallback status note,
4. if fallback is unavailable or over quota, show a precise retail error.

### Confirmed tasks

When a confirmed task starts:

1. evaluate whether the task likely needs vision,
2. choose local if local generation is healthy and local vision is available when needed,
3. otherwise choose hosted fallback if quota allows,
4. pass screenshots to the hosted path for vision tasks.

The advanced agent should treat a hosted OpenAI-compatible endpoint as vision-capable when configured that way; the current hardcoded `supports_vision: false` behavior must be removed for the hosted fallback path.

### UI

Desktop UI should show:

- whether `Free AI` is currently local or using hosted fallback,
- whether fallback is available,
- remaining hosted fallback quota for free users,
- why fallback was chosen when local failed.

It should not expose raw backend implementation names like vLLM to normal users.

## Error Handling

### Local macOS Metal failures

- If the local runtime is app-managed, attempt compatibility recovery first.
- If the local path still fails after recovery, attempt hosted fallback before surfacing failure.
- If the local service is truly external, skip managed-runtime mutation and offer hosted fallback immediately if available.

### Hosted fallback failures

Return normalized errors for:

- fallback unavailable because backend is not configured,
- fallback unavailable because quota is exhausted,
- fallback unavailable because desktop auth is missing,
- fallback temporarily unavailable because hosted inference is unhealthy.

Do not leak upstream provider stack traces into the retail UI.

## Testing Strategy

### Local runtime bug fix

- prove managed metadata plus running service is treated as app-managed even without a live child handle,
- prove external-service classification still works when no metadata exists,
- prove compatibility fallback picks managed recovery only for genuinely app-managed state.

### Desktop routing

- chat uses hosted fallback when local generation fails,
- confirmed tasks use hosted fallback when local vision is unavailable,
- hosted fallback is blocked when quota is exhausted,
- local path remains primary when healthy.

### API

- authenticated desktop session required,
- free/plus quota policy enforced correctly,
- usage counters persist per user per day,
- fallback responses proxy and normalize errors correctly.

## Trade-offs

- Hosted fallback improves reliability but adds infrastructure cost.
- Vision-capable fallback helps free users recover fully, but means screenshot payloads can leave the device in fallback mode; this must be explained clearly.
- Keeping `Free AI` as one provider preserves UX simplicity, but requires more internal routing logic.

## Recommendation

Implement all three pieces together:

1. local ownership/readiness fix,
2. hosted fallback backend and quotas,
3. desktop routing and UI explanation.

Doing only one of these would leave the product in a half-fixed state:

- only fixing local classification still leaves users blocked when local inference is impossible,
- only adding hosted fallback leaves an obvious local bug in place,
- only adding quotas without routing does not improve usability.
