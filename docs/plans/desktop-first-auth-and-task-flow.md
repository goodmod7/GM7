# Desktop-First Auth And Task Flow Design

**Problem**

The product currently behaves like a web dashboard that happens to control a paired desktop. The desired direction is the opposite: the desktop app should be the main product surface, with the web app limited to browser-based auth, billing, downloads, account management, and admin/debug workflows.

**Recommended Approach**

Adopt a desktop-first sign-in flow built on the existing `deviceId + deviceToken + run` model.

- Desktop sign-in uses the external system browser only.
- The browser callback uses a loopback redirect to `127.0.0.1`, not an embedded webview.
- The auth handoff uses a short-lived one-time token with state/nonce validation and single-use exchange.
- The durable desktop credential remains the existing per-device token stored in the desktop keychain.
- Pairing endpoints remain temporarily for migration, but pairing disappears from the primary desktop UX.
- The web dashboard remains available for auth, billing, downloads, account/device management, and admin/debug fallback.

**Implemented State As Of 2026-03-10**

- Phase 1 is implemented: desktop browser sign-in, one-time handoff, durable device token storage, sign-out, and revoke.
- Phase 2 is implemented: desktop starts tasks directly through the existing run model and remains the primary task surface.
- Phase 3 and Phase 4 posture are implemented in the current product shell:
  - desktop exposes account/device session management
  - web dashboard is desktop-first
  - legacy pairing and web run creation remain available only behind `Admin / Legacy Tools`

## 1. Auth And Connection Model

Desktop sign-in becomes the ownership flow for a device.

1. The signed-out desktop creates a local auth attempt with `deviceId`, `state`, `nonce`, a random loopback port, and a short timeout.
2. The desktop calls `POST /desktop/auth/start` so the API can validate and register the attempt.
3. The desktop opens the system browser to a web route such as `/desktop/sign-in?attemptId=...`.
4. The web flow requires normal browser auth. After success, the API issues a short-lived one-time handoff token bound to:
   - `deviceId`
   - auth attempt id
   - exact callback URL
   - `state`
   - `nonce` or nonce hash
   - expiry `<= 2 minutes`
5. The web flow redirects the browser to the exact loopback callback on `127.0.0.1` with the handoff token and `state`.
6. The desktop validates `state`, then calls `POST /desktop/auth/exchange`.
7. The API atomically consumes the handoff token, rotates or issues the durable `deviceToken`, and returns account/device-session bootstrap data.
8. The desktop stores the `deviceToken` in the existing keychain bridge and reconnects through the current WebSocket `device.hello` flow.

Multi-device policy:

- Multiple desktops may be signed in simultaneously.
- Each desktop has its own durable `deviceToken`.
- Re-signing on the same desktop may rotate that desktop's token.
- No automatic cross-device revocation happens when a user signs in on another desktop.

Logout and revoke:

- Desktop sign-out clears the local keychain token and calls an API revoke endpoint for that device session.
- Account/device management later exposes explicit remote revoke for individual desktop sessions.

## 2. Desktop-First UX Model

Desktop becomes the primary operator surface.

- Signed-out desktop shows `Sign in` instead of a pairing code.
- Auth and connection state are distinct:
  - desktop may be connected to the API runtime
  - but still signed out from an account
- Signed-in desktop shows:
  - main task composer
  - provider/model selector
  - readiness checklist for subscription, permissions, workspace, and provider setup
  - current run/task panel
  - approvals panel
  - recent task history

The web app is intentionally demoted:

- keep: browser auth, billing, downloads, account info, account/device management, admin/debug
- demote: dashboard-first task initiation
- retain temporarily: web run creation as fallback/admin flow

## 3. Backend/API Changes

Reuse the current device and run plumbing instead of introducing a parallel desktop session stack.

- Keep durable desktop ownership on the existing `Device` row and `deviceToken`.
- Keep WebSocket device identity on `deviceId + deviceToken`.
- Keep task creation and execution on the existing `Run`, `RunStep`, `Action`, and `ToolEvent` model.

Add desktop-first auth endpoints:

- `POST /desktop/auth/start`
  - registers a short-lived auth attempt
- browser-facing desktop sign-in completion route
  - verifies browser auth and issues a handoff token
- `POST /desktop/auth/exchange`
  - validates and consumes the handoff token
  - returns or rotates the durable `deviceToken`
- `POST /desktop/auth/logout`
  - revokes the current device session
- `GET /desktop/me` or equivalent bootstrap endpoint
  - returns account, subscription, and device-session summary for desktop UI

For the current single-instance deployment mode, the short-lived auth-attempt store can remain in memory. Durable desktop ownership stays in Postgres on the `Device` row.

## 4. Rollout And Migration Strategy

Phase 1:

- implement desktop sign-in handoff
- hide pairing from the primary desktop UX
- keep pairing endpoints working for existing builds and migration

Phase 2:

- let desktop create tasks directly through the backend using the current run model
- keep web task creation as secondary/admin/debug fallback

Phase 3:

- add desktop bootstrap and device-session revoke/account-management endpoints
- treat desktop as a first-class initiating client, not just a passive controlled device

Phase 4:

- remove pairing language from the desktop product flow
- keep legacy pairing endpoints only while older clients still depend on them
- add migration docs and update operator guidance

Backward compatibility:

- already-paired desktops with stored `deviceToken`s continue to work
- new desktops sign in through browser auth instead of pairing
- the server accepts both flows during rollout

## 5. Security Model And Native-App Auth Constraints

Security requirements for the new flow:

- external system browser only
- no embedded login webview
- exact callback/redirect validation
- short-lived handoff token with expiry `<= 2 minutes`
- state and nonce validation
- single-use exchange with atomic consume-once semantics
- loopback listener bound only to `127.0.0.1`

Loopback redirect is the preferred callback pattern for this codebase because:

- it avoids embedded auth UI
- it fits the current strict desktop webview navigation restrictions
- it reuses the audited external opener path already present in Tauri
- it avoids early OS-specific custom URI registration work across packaged targets
- it works in local dev and production packaging with lower rollout risk than a new custom URI scheme

The existing security posture must remain intact:

- local approval model stays unchanged
- screenshots remain non-persistent
- LLM API keys remain local to the desktop keychain and never move server-side
- logs and diagnostics keep redacting typed text, file contents, tokens, and terminal args

## Alternatives Considered

1. Keep pairing and only improve the dashboard.
   Rejected because it preserves the current product smell and keeps desktop as a secondary surface.

2. Use an app-registered custom URI scheme first.
   Rejected for Phase 1 because it adds more packaging and OS integration risk than needed for the initial desktop-first migration.

3. Use loopback callback first, with the handoff token model designed so a custom URI scheme can be added later.
   Recommended because it is the least risky path that still delivers the required desktop-first auth flow.
