# Desktop Task Confirmation And Glass Overlay Design

## Context

The desktop assistant currently starts a new task immediately from chat, enters overlay mode, and can complete locally without ever surfacing a final assistant message back into chat. In the current UI, `done` results are shown in the run panel but are not appended to the chat transcript, and overlay status text falls back to "GORKH is thinking…" for unhandled states.

The user wants three behavior changes:

1. Before a new task starts, GORKH must restate its understanding and ask the user to confirm.
2. When a task completes or errors, the result must be visible to the user in chat, not just in internal run state.
3. Overlay mode should stay readable but become much more transparent so the user can watch desktop actions underneath it.

## Approaches Considered

### 1. Desktop-local confirmation and result surfacing

Handle confirmation entirely in `App.tsx` before creating a new assistant run, append `done` summaries into chat, and restyle the overlay components to a lighter glass treatment.

Pros:
- Reliable and immediate.
- Does not depend on the local model before execution starts.
- Minimal blast radius; all behavior is already owned by the desktop shell.

Cons:
- Confirmation phrasing is deterministic rather than model-generated.

### 2. Ask the model to paraphrase and request confirmation

Start a lightweight assistant turn first, ask it to restate the task, then require user approval before the real task execution starts.

Pros:
- More flexible and natural sounding.

Cons:
- Adds another model dependency before every task.
- Reintroduces the same hang risk the user is trying to avoid.
- More state complexity around warmup and first-run behavior.

### 3. Server-backed preflight confirmation

Persist confirmation state in run/backend state and gate `run.start` on an explicit confirmation command.

Pros:
- Uniform lifecycle across clients.

Cons:
- Overbuilt for a desktop-local UX problem.
- Adds API/protocol complexity without solving the missing result rendering problem by itself.

## Recommended Design

Use approach 1.

### New Task Confirmation

- Add desktop-local `pendingTaskConfirmation` state that stores the original requested task text and a derived confirmation message.
- When the user sends a message and there is no active non-warmup run to continue, do not create the run immediately.
- Instead, append an agent message that says GORKH's understanding in plain language and asks whether it should proceed.
- Render explicit `Proceed` and `Cancel` controls in the main chat surface while confirmation is pending.
- On `Proceed`, create the run and start the assistant using the original task text.
- On `Cancel`, clear the pending confirmation and append a short cancellation acknowledgment.
- If the user sends a different new message while a confirmation is pending, replace the pending confirmation with the new request.

### Result And Status Surfacing

- Extend the existing proposal-to-chat synchronization so that `currentProposal.kind === 'done'` appends the completion summary into chat exactly once.
- Preserve the current `ask_user` sync behavior.
- Update the overlay status label logic so it explicitly handles:
  - `done`
  - `error`
  - `asking_user`
  - `awaiting_approval`
  - `paused`
  - `executing`
  - `thinking`
- This removes the current fallback that incorrectly displays "GORKH is thinking…" for completed/error states.

### Glass Overlay Treatment

- Keep the overlay shell and controller architecture intact.
- Reduce the fullscreen atmospheric layer from a dark dimming treatment to a near-clear blur/glass layer.
- Keep cards readable with lighter translucent panels, thin borders, and modest blur instead of heavy black fills.
- Preserve pointer behavior: the overlay shell remains non-interactive and the compact controller/details surfaces stay interactive.

## Error Handling

- Confirmation state must clear on:
  - sign out
  - stop AI
  - successful task start
- If task start fails after confirmation, show the error in chat and clear the pending confirmation.
- If the assistant reaches `error`, chat should still surface the error through the existing `onError` path, and the status label should reflect the error state instead of a thinking fallback.

## Testing Strategy

- Add source-based desktop regressions that verify:
  - new tasks are gated behind a pending confirmation step
  - confirmation controls are present in the main chat surface
  - `done` summaries are appended into chat
  - overlay labels explicitly handle `done` and `error`
  - overlay shell/controller styling uses lighter translucent glass instead of heavy dark dimming

## Files Expected

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/ChatOverlay.tsx`
- `apps/desktop/src/components/ActiveOverlayShell.tsx`
- `apps/desktop/src/components/OverlayController.tsx`
- `tests/desktop-chat-entry.test.ts`
- `tests/desktop-overlay-visual-shell.test.mjs`
- `tests/desktop-overlay-controller.test.mjs`
- possibly a new desktop overlay/chat behavior regression test if keeping concerns separate is clearer
