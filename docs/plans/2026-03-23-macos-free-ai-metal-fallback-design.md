# macOS Free AI Metal Fallback Design

**Date:** 2026-03-23

## Problem

Free AI on macOS can reach the local Ollama-compatible service successfully, but the local runner may crash during Metal backend initialization with errors like `MTLLibraryErrorDomain Code=3`, `Input types must match cooperative tensor types`, and `ggml_metal_init: error: failed to initialize the Metal library`.

This breaks both chat and the Settings `Test Connection` action because both paths execute a real `/api/generate` request against the selected local model.

## Root Cause

The current managed runtime path launches Ollama with only host, models, and keepalive environment variables. It has no backend compatibility fallback for known macOS Metal runner failures. The app also uses any existing Ollama-compatible service listening on `127.0.0.1:11434`, so the same user-facing failure can come from either:

- the app-managed Ollama runtime, or
- an external Ollama install already running on the machine.

The direct crash is in the local runtime/backend layer, not in the desktop UI or request formatting layer.

## Goals

- Keep retail users unblocked when the app-managed runtime hits a known macOS Metal crash.
- Preserve fast GPU-backed behavior on healthy Macs.
- Avoid mutating or reconfiguring an external Ollama install silently.
- Replace raw backend crash text with clearer retail-facing messages while preserving support details.

## Non-Goals

- Replacing Ollama.
- Fixing upstream ggml/Metal bugs in this repo.
- Forcing all macOS Free AI sessions into CPU mode.
- Automatically modifying an external Ollama service owned by the user.

## Chosen Approach

When the app-managed Free AI runtime fails with a recognized macOS Metal crash signature, GORKH will:

1. classify the error as a managed runtime backend compatibility failure,
2. stop the managed Ollama child process if GORKH started it,
3. restart the managed runtime in CPU-safe compatibility mode,
4. retry the failed request once, and
5. surface compatibility-mode status in support details and user-facing recovery copy.

If the failure comes from an external Ollama service already running on `127.0.0.1:11434`, GORKH will not try to reconfigure it. Instead it will surface a clear message that the local AI service on the machine is crashing on the Mac graphics path and should be restarted or replaced outside the app.

## Compatibility Mode

Compatibility mode is a managed-runtime-only launch mode used after a detected Metal crash on macOS. The runtime launch environment will be adjusted to prefer CPU-safe execution rather than the failing Metal path. This mode should remain sticky for the current managed install so repeated chat attempts do not thrash between Metal and CPU-safe startup.

## User Experience

### Chat

- First failure on managed runtime: auto-recover in the background, retry once, then continue if successful.
- If recovery succeeds, the user should not see the raw Metal compiler dump.
- If recovery fails, show a short message explaining that Free AI hit a Mac graphics compatibility issue and GORKH switched to compatibility mode but could not recover automatically.

### Settings

- `Test Connection` should show a clear compatibility message rather than the raw backend stack dump when the error is recognized.
- Support details should still expose runtime source, version, selected model, and compatibility mode state.

### Free AI Setup Card

- Add a visible support detail indicating whether compatibility mode is active.

## Scope

The initial fix only changes the desktop-managed local AI path:

- managed runtime metadata/state,
- managed runtime launch environment,
- local Ollama request retry path,
- retail-facing error normalization and messaging,
- tests covering managed vs external runtime behavior.

## Risks

- CPU-safe mode will be slower on affected Macs.
- If the fallback detection is too broad, the app could mask unrelated Ollama server errors.
- If the compatibility mode state is not persisted clearly, users may see inconsistent support details.

## Validation

- Add tests for Metal crash classification and auto-fallback behavior.
- Verify the managed path retries once and no more.
- Verify external-service failures do not trigger managed fallback.
- Verify settings/chat user-facing copy no longer dumps raw Metal crash text for the recognized case.
