# Security Posture and Threat Model

This document describes the current production security posture for AI Operator and the trust boundaries around remote control, billing, and desktop privileges.

## Security Goals

Primary attacker goals:
- take control of a paired desktop without the local user's knowledge
- steal browser sessions, device tokens, or admin credentials
- abuse subscription-gated APIs or billing flows
- exfiltrate workspace data through tool execution or logs
- retain screenshots or sensitive audit data longer than needed

Primary defensive goals:
- keep privileged desktop actions local, explicit, and auditable
- minimize long-lived secrets and never persist local LLM credentials server-side
- require TLS and secure cookie settings in production
- bound operational data retention so logs and audit trails do not grow without limit

## Trust Boundaries

### Browser to API

- Browser auth uses HttpOnly access and refresh cookies plus a double-submit CSRF cookie.
- Cookie-authenticated mutations require a matching `x-csrf-token` header.
- `Authorization: Bearer` clients are supported for API use cases and are exempt from CSRF.
- Production startup rejects insecure `APP_BASE_URL` and `WEB_ORIGIN` values unless `ALLOW_INSECURE_DEV=true` is set explicitly.

### Desktop to API

- Devices connect over WebSocket and identify with a device id plus a device token after pairing.
- Device tokens are stored locally via the desktop keychain bridge rather than in the web app or browser storage.
- The server stores subscription state, audit events, run state, session state, and Stripe event ids.
- The server does not persist screenshots.

### Desktop Privilege Boundary

- Screen capture, input injection, local tool execution, and local LLM access run on the desktop client.
- Remote control remains opt-in and approval-gated on the desktop UI.
- Every privileged desktop request now enters an explicit local approval state machine with timeout and cancelation handling.
- Tool execution is scoped to a configured local workspace root.
- LLM API keys must remain local to the desktop client and must not be stored server-side.

### Desktop IPC Lockdown

- The desktop webview is limited to an explicit audited Tauri command allowlist.
- Generic shell, filesystem, and opener guest APIs are not exposed to the frontend.
- Workspace folder selection is mediated through a narrow native command instead of direct dialog plugin access.
- External URL opens must go through a validated command that requires `https://` and allows only approved hosts such as Stripe, GitHub, or the configured app origin.
- The webview denies arbitrary new-window creation and blocks navigation away from the local app content.
- Production desktop builds reject insecure `http://` and `ws://` API endpoints by default.

## Key Mitigations

### Local approvals for privileged actions

- Remote control actions require local user approval on the desktop.
- AI tool proposals require approval before filesystem or terminal actions execute.
- Desktop screen preview and remote control remain explicit opt-in settings.
- Tauri IPC hardening reduces the frontend blast radius, but it does not replace the local approval model for privileged actions.
- Approval items transition through explicit states: `pending`, `approved`, `denied`, `expired`, `canceled`, `executing`, `executed`, and `failed`.
- Pending approvals expire after 60 seconds by default and must be re-requested instead of executing late.
- `Stop All` cancels pending approvals, pauses AI assist, and turns off the local control/screen-preview toggles so privileged work cannot continue through stale UI state.
- Disabling `Allow Control`, disabling `Screen Preview`, clearing the workspace, or pausing AI assist cancels dependent pending approvals before execution.

### Native permission diagnostics

- The desktop app surfaces best-effort native permission status for Screen Recording and Accessibility.
- On macOS, the app can open the relevant System Settings privacy panes for Screen Recording and Accessibility.
- On platforms where reliable detection is not available, the app reports `unknown` and falls back to error-guided onboarding.
- Screen-capture failures surface Screen Recording guidance; input-injection failures surface Accessibility guidance.

### Session and CSRF defenses

- Access and refresh cookies are `HttpOnly`.
- Session cookies use `SameSite=Lax`.
- Session and CSRF cookies are marked `Secure` in production.
- Cookie-authenticated POST endpoints such as refresh, logout, checkout, portal, pairing, action creation, and run creation/cancel enforce CSRF.
- The Stripe webhook remains intentionally exempt because it is public and signature-verified.

### Security headers and transport

- API responses set `X-Content-Type-Options: nosniff`.
- API responses set `Referrer-Policy: no-referrer`.
- API responses set `X-Frame-Options: DENY`.
- API responses set a restrictive `Permissions-Policy` baseline.
- Production responses set HSTS.
- Sensitive auth and URL-bearing responses use `Cache-Control: no-store`.
- Production deployments should terminate TLS at the edge and use HTTPS for all browser-visible origins.
- Desktop production builds should use `https://` for `VITE_API_HTTP_BASE` and `wss://` for `VITE_API_WS_URL`.

### Logging and audit safeguards

- Request authorization headers, cookies, and `Set-Cookie` headers are redacted in API logging.
- The API redacts token-, secret-, password-, and key-shaped fields before logging arbitrary objects or errors.
- Typed text content is not logged in cleartext for remote-control actions.
- Audit events record who requested sensitive actions without storing screenshots or raw secrets.
- Desktop approval history is privacy-safe: typed text content, file contents, terminal arguments, tokens, and raw LLM keys are not persisted in the local approval diagnostics export.
- The desktop keeps a short in-memory/local approval history for operator support and timeout/cancelation auditing, not for content capture.

### Rate limiting and presence

- HTTP auth, billing, run creation, SSE, control actions, and tool events are rate limited.
- Redis-backed rate limiting and presence are supported for production deployment hygiene.
- If Redis is unavailable, the API falls back to in-memory behavior and emits warnings.

### Retention controls

- Audit events are pruned after `AUDIT_RETENTION_DAYS`.
- Stripe webhook event ids are pruned after `STRIPE_EVENT_RETENTION_DAYS`.
- Revoked sessions are pruned after `SESSION_RETENTION_DAYS`.
- Expired sessions are pruned after a short grace period.
- Terminal runs (`done`, `failed`, `canceled`) are pruned after `RUN_RETENTION_DAYS`.

## Operational Guidance

- Keep `ADMIN_API_KEY` secret and rotate it if exposed.
- Keep `METRICS_PUBLIC=false` unless metrics are on a private network.
- Keep `ALLOW_INSECURE_DEV=false` in production.
- Use HTTPS for `WEB_ORIGIN`, `APP_BASE_URL`, and `API_PUBLIC_BASE_URL` in production.
- Use `https://` and `wss://` desktop API endpoints in production packages.
- Use `VITE_DESKTOP_ALLOW_INSECURE_LOCALHOST=true` only for local debug packaging, never for real production distribution.
- Do not log or persist raw LLM API keys on the server.
- Do not add screenshot persistence to disk or database storage.
- Treat Docker env files and deployment secrets as production credentials.
- Review audit event volume and retention settings as part of production capacity planning.

## Intentional Exemptions

- `POST /billing/webhook` is exempt from CSRF because it is a public Stripe callback protected by webhook signature verification.
