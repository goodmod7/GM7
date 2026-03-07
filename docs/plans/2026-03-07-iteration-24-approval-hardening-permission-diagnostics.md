# Iteration 24 Plan: Approval Hardening and Native Permission Diagnostics

## Goal

Strengthen the desktop trust boundary by:
- consolidating privileged approvals into a single state machine with expiry and cancelation
- making approval history auditable without storing secrets
- adding native permission diagnostics and guided remediation for screen capture and input control

## Constraints

- every privileged control action and tool execution must remain locally approved
- approvals must expire by default after 60 seconds
- disabling the dependent feature must cancel related pending approvals
- local logs and exported diagnostics must not contain typed text, file contents, terminal args, tokens, or other secrets
- do not weaken Iteration 23 desktop lockdown

## Scope

### New state machine

Create `apps/desktop/src/lib/approvals.ts` with:
- `ApprovalKind = "control_action" | "tool_call" | "ai_proposal"`
- `ApprovalState = "pending" | "approved" | "denied" | "expired" | "canceled" | "executing" | "executed" | "failed"`
- privacy-safe summaries and risk classification helpers
- controller methods for create, approve, deny, cancel, expire, subscribe, and batch cancel
- in-memory history limit 200, persisted history limit 50
- diagnostics export payload for approval history plus permission status

### Flow wiring

- web control action requests become `control_action` approval items
- AI action proposals become `ai_proposal` approval items
- AI tool proposals become `tool_call` approval items
- expiry and cancelation transitions produce the correct no-execute behavior
- `Stop All` cancels pending approvals, pauses AI Assist, and disables control plus screen preview after confirmation

### Native permission diagnostics

Add Tauri commands:
- `permissions_get_status`
- `permissions_open_settings`

Behavior:
- macOS accessibility: best-effort trusted-process check
- macOS screen recording: best-effort capture-based detection, otherwise `unknown`
- other platforms: `unknown` or safe no-op settings open

### UI updates

- show permission status and remediation steps in Settings
- surface actionable permission guidance when capture or input injection fails
- add diagnostics export button

## Files Expected

- `apps/desktop/src/lib/approvals.ts`
- `apps/desktop/src/lib/permissions.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/aiAssist.ts`
- `apps/desktop/src/lib/actionExecutor.ts`
- `apps/desktop/src/components/ActionApprovalModal.tsx`
- `apps/desktop/src/components/ToolApprovalModal.tsx`
- `apps/desktop/src/components/ScreenPanel.tsx`
- `apps/desktop/src/components/SettingsPanel.tsx`
- `apps/desktop/src/components/RunPanel.tsx`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/permissions/desktop-ipc.toml`
- `tests/desktop-approvals.test.ts`
- `tests/desktop-security-config.test.mjs`
- `tests/desktop-tauri-commands.test.mjs`
- `scripts/check-desktop-security.mjs`
- docs updates

## TDD Sequence

1. Add failing tests for approval expiry, redacted summaries, and batch cancelation.
2. Update desktop command inventory tests to require the new permission commands.
3. Implement the controller and permission wrappers.
4. Wire App and AI Assist to use the controller for all privileged approvals.
5. Add Tauri permission diagnostics commands and UI guidance.
6. Run full verification:
   - `pnpm -w build`
   - `pnpm -w typecheck`
   - `pnpm -w test`
   - `pnpm check:desktop:security`
