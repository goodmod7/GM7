# Investor Free AI Flow Design

## Goal

Keep `Free AI` as the only no-key user-facing free option in the desktop settings while hiding the Modal-backed compatibility path behind the existing Render fallback.

## Current Problem

- Settings still advertises `Custom OpenAI-compatible`, which is not part of the investor story.
- `Free AI` settings test only checks the local Ollama path, so it surfaces a Mac graphics error even when the hosted fallback is healthy.
- Hosted fallback errors still reuse generic `local server` wording, which is misleading when the request is going to Render.

## Approved Approach

1. Hide `Local OpenAI-compatible` from the launch-facing provider menu while keeping it available as a compatibility provider for existing saved setups.
2. Treat `Free AI` settings testing as a managed flow:
   - try local first
   - if local fails for a known fallback-worthy reason and the desktop session is signed in, test the authenticated Render fallback instead
3. Improve hosted-fallback error messaging so remote failures do not talk about a `local server`.
4. Keep the Modal URL and API key only on Render. Do not expose either in the desktop UI or bundle them into the app.

## Files In Scope

- `apps/desktop/src/components/SettingsPanel.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/freeAiFallback.ts`
- `apps/desktop/src/lib/llmConfig.ts`
- `apps/desktop/src-tauri/src/llm/openai_compat.rs`
- desktop fallback/provider tests

## Success Criteria

- Investor-facing settings show `Free AI`, `OpenAI`, and `Claude` as the official launch providers.
- `Free AI` test can report success through the hidden Render fallback when local Ollama is unavailable.
- Hosted fallback failures mention the hosted fallback service instead of a local server.
- No Modal URL or Modal API key becomes user-configurable or embedded in the desktop app.
