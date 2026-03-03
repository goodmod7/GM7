# AI Operator

A TeamViewer-style AI operator product with desktop overlay UI, web portal, and API backend.

## Architecture

- `apps/desktop` - Tauri + Vite + React overlay UI (runs locally for system permissions)
- `apps/web` - Next.js web portal
- `apps/api` - Fastify API + WebSocket server
- `packages/shared` - Shared TypeScript types and protocol definitions

## Prerequisites

- Node.js >= 20
- pnpm (via Corepack)
- Rust (for Tauri desktop app)

## Quick Start

```bash
# Install dependencies
pnpm install

# Run dev mode (all apps in parallel)
pnpm dev

# Build everything
pnpm -w build

# Type check
pnpm -w typecheck

# Format code
pnpm format
```

## Development

### Starting Infrastructure

```bash
cd infra
docker-compose up -d   # Starts Postgres (5432) + Redis (6379)
```

### Database Migrations

```bash
pnpm --filter @ai-operator/api db:migrate
```

### API Server

```bash
pnpm --filter api dev
# Runs on http://localhost:3001
# WebSocket endpoint: ws://localhost:3001/ws
# SSE endpoint: http://localhost:3001/events
```

REST endpoints:
- `POST /auth/register` - Create an account
- `POST /auth/login` - Set `access_token`, `refresh_token`, and `csrf_token` cookies (still returns JWT token for API compatibility)
- `POST /auth/refresh` - Rotate the refresh token and issue a new access token
- `POST /auth/logout` - Revoke the current session and clear auth cookies
- `POST /auth/logout_all` - Revoke all sessions for the current user
- `GET /auth/me` - Get the current user
- `GET /auth/sessions` - List browser sessions for the current user
- `GET /billing/status` - Get current subscription status
- `POST /billing/checkout` - Start Stripe Checkout for the subscription plan
- `POST /billing/portal` - Open Stripe Customer Portal
- `POST /billing/webhook` - Stripe webhook receiver
- `GET /downloads/desktop` - Subscription-gated desktop installer metadata
- `GET /updates/desktop/:platform/:arch/:currentVersion.json` - Desktop updater manifest feed (stubbed in dev)
- `GET /admin/health` - Admin-only aggregate health metrics (`x-admin-api-key`)
- `GET /health` - Health check
- `GET /devices` - List all devices
- `GET /devices/:deviceId` - Get specific device
- `GET /devices/:deviceId/screen.png` - Get screen preview (Iteration 4)
- `POST /devices/:deviceId/pair` - Pair a device with code
- `GET /runs` - List all runs
- `GET /runs/:runId` - Get specific run
- `POST /runs` - Create a new run
- `POST /runs/:runId/cancel` - Cancel a run
- `GET /events` - SSE stream for real-time updates

### Web Portal

```bash
pnpm --filter web dev
# Runs on http://localhost:3000
```

Register at `/register`, then log in at `/login`. The web app now uses an HttpOnly access-token cookie, an HttpOnly refresh-token cookie, and a double-submit CSRF cookie for browser mutations. The API still accepts `Authorization: Bearer` for API clients.

Navigate to `/dashboard` to:
- See connected devices
- Pair devices using pairing codes
- Create and monitor runs in real-time (via SSE)
- Cancel active runs
- **View screen preview** (Iteration 4) - click "View Screen" on a device with streaming enabled

The `/download` page is subscription-gated. It reads release metadata from the API. In `DESKTOP_RELEASE_SOURCE=file` mode, the API serves the Iteration 13 env-based URLs. In `DESKTOP_RELEASE_SOURCE=github` mode, it derives the latest version and installer links from GitHub Release assets.

### Desktop App

**IMPORTANT:** The desktop application must be run locally on your machine, not in a remote container or Codespace, because it requires native system permissions.

```bash
# First, expose your Codespace or use local API
# Update apps/desktop/.env.local with your API URL:
# VITE_API_WS_URL=ws://localhost:3001/ws
# VITE_API_HTTP_BASE=http://localhost:3001
# VITE_DESKTOP_UPDATER_ENABLED=false
# VITE_DESKTOP_UPDATER_PUBLIC_KEY=your_tauri_updater_public_key

pnpm --filter desktop dev
# Or for Tauri:
pnpm --filter desktop tauri:dev
```

Desktop auto-update is configured through the API updater feed at `/updates/desktop/...`. In `DESKTOP_RELEASE_SOURCE=file` mode, the API serves stub manifests from `apps/api/updates`. In `DESKTOP_RELEASE_SOURCE=github` mode, it builds the updater response dynamically from GitHub Release assets and `.sig` files.

The desktop app now runs as an always-on tray agent. Closing the window hides it to the system tray instead of exiting. Use the tray menu to show the app again or choose `Quit` to fully exit. Screen preview and remote control remain opt-in and can be toggled from the tray or the desktop UI.

The Settings panel includes:
- `Start minimized to tray`
- `Launch at startup` (best-effort in dev, supported on macOS and Windows packaged builds)

### Desktop Development

Install Rust with the stable toolchain and the standard desktop prerequisites for Tauri on your OS. To validate the desktop Rust and Tauri project locally, run:

```bash
pnpm --filter @ai-operator/desktop tauri:check
```

That command runs:
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `tauri build --debug`

CI now compiles the desktop app on both macOS and Windows for pull requests and pushes to `main`, so Rust/Tauri regressions fail before release tags.

### Stripe + Desktop Release Dev Notes

- Set `WEB_ORIGIN` and `APP_BASE_URL` so cookie auth and Stripe redirects match your local or Codespace URLs.
- Use `stripe listen --forward-to localhost:3001/billing/webhook` and `stripe trigger customer.subscription.updated` to exercise billing webhooks.
- Use `DESKTOP_RELEASE_SOURCE=file` for local stubbed downloads, or `DESKTOP_RELEASE_SOURCE=github` with `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME` to make GitHub Releases the source of truth.
- Set `ADMIN_API_KEY` if you want to use `/admin/health` for aggregate runtime diagnostics.
- See [docs/releasing.md](/workspaces/GM7/docs/releasing.md) for the GitHub Actions desktop release flow and required CI secrets.

## Iteration 5: Remote Control (Safety-First)

### Features Implemented

1. **Safe Remote Control**
   - **Opt-in only**: Control is OFF by default
   - Desktop toggle "Allow Remote Control" with kill switch
   - **Every action requires user approval** via desktop modal
   - No silent automation possible

2. **Control Primitives**
   - **Click** - Single mouse click at normalized coordinates
   - **Double-click** - Double mouse click
   - **Scroll** - Scroll wheel (dx, dy)
   - **Type** - Keyboard text entry (max 500 chars)
   - **Hotkey** - Key combinations (Enter, Tab, arrows, etc.)

3. **Safety Guardrails**
   - **Rate limiting**: Max 5 actions per 10 seconds per device
   - **Privacy**: Typed text is never logged or displayed
   - **Approval modal**: Shows action type without sensitive content
   - **Coordinates**: Normalized (0-1) mapped to display pixels

4. **Web Dashboard Controls**
   - Click on screen preview to send click actions
   - Type text with input field
   - Hotkey buttons (Enter, Tab, Esc, arrows)
   - Scroll on preview image
   - Action status tracking in real-time

5. **Permissions**
   - macOS: Requires **Accessibility** permission for input injection
   - Desktop shows guidance banner if permission denied

### Control Flow

```
1. User enables "Allow Control" on desktop
   ↓
2. Web dashboard shows "Remote Control Active" panel
   ↓
3. User clicks on screen preview or presses hotkey
   ↓
4. POST /devices/:id/actions { kind: "click", x, y }
   ↓
5. Server creates action (rate limit check), forwards via WS
   ↓
6. Desktop receives server.action.request
   ↓
7. Desktop shows approval modal (user must approve)
   ↓
8. On approve: Desktop invokes Tauri input injection command
   ↓
9. Desktop sends device.action.result with status
   ↓
10. Server broadcasts action_update SSE
   ↓
11. Web dashboard shows action status
```

### macOS Permission

On macOS, input injection requires **Accessibility** permission:

1. First attempt will fail with permission error
2. Desktop shows: "Accessibility permission required"
3. User goes to: System Settings → Privacy & Security → Accessibility
4. Enable for AI Operator app
5. Restart remote control

## Iteration 4: Screen Preview (Privacy-First)

### Features Implemented

1. **Safe Screen Streaming**
   - **Opt-in only**: Screen sharing is OFF by default
   - Toggle in desktop overlay to enable/disable
   - FPS selector (1 or 2 FPS)
   - Display selector for multi-monitor setups

2. **Privacy Protections**
   - Only **latest frame** stored in memory (no history)
   - Auto-expires after **60 seconds**
   - **Max 1MB** per frame
   - **Max 1280px width** (downscaled with aspect ratio preserved)
   - **No persistence**: Frames never written to disk/DB
   - **No recording**: Live preview only

3. **Tauri Screen Capture**
   - Cross-platform using `screenshots` crate
   - macOS: Requires Screen Recording permission
   - Windows: Works out of the box
   - Permission error handling with user guidance

4. **Web Dashboard Preview**
   - Click "View Screen" on a paired device
   - Real-time updates via SSE
   - Shows resolution, file size, last update time

### Screen Streaming Flow

```
1. User enables "Share Screen Preview" in desktop overlay
   ↓
2. Desktop sends device.screen.stream_state { enabled: true, fps: 1 }
   ↓
3. Desktop captures PNG periodically via Tauri Rust command
   ↓
4. Desktop sends device.screen.frame { meta, dataBase64 }
   ↓
5. Server validates, stores latest frame, broadcasts SSE screen_update
   ↓
6. Web dashboard receives SSE, updates image src
   ↓
7. User sees live screen preview
```

### macOS Permission

On macOS, screen capture requires **Screen Recording** permission:

1. First attempt will fail with permission error
2. Desktop shows: "Screen Recording permission required"
3. User goes to: System Settings → Privacy & Security → Screen Recording
4. Enable for AI Operator app
5. Restart screen sharing

## Iteration 6: AI Assist Mode (BYOK)

### Features Implemented

1. **AI-Assisted Runs**
   - Device uses an LLM (OpenAI-compatible) to propose actions one at a time
   - Based on current screenshot + goal + action history
   - Proposes: `propose_action`, `ask_user`, or `done`

2. **Safety-First Design**
   - **Every action requires explicit local approval** (no silent execution)
   - Desktop shows proposal card with rationale + Approve/Reject
   - User can stop AI at any time

3. **BYOK (Bring Your Own Key)**
   - API keys stored in OS keychain (keyring)
   - Keys never sent to server
   - Configure provider, base URL, and model in Settings

4. **Run Constraints**
   - Default: max 20 actions, max 20 minutes
   - Action count tracked and displayed
   - Graceful handling of limits reached

5. **Modes**
   - `manual`: Server-driven 4-step plan (existing behavior)
   - `ai_assist`: Device-driven AI loop

### AI Assist Flow

```
1. Web dashboard creates run with mode="ai_assist"
   ↓
2. Desktop receives server.run.start with constraints
   ↓
3. Desktop captures screenshot
   ↓
4. Desktop calls LLM (locally, via Rust) with prompt
   ↓
5. Desktop sends device.agent.proposal to server
   ↓
6. Desktop shows proposal card to user
   ↓
7. User clicks Approve → Desktop executes action locally
   ↓
8. Desktop sends device.action.create + device.action.result
   ↓
9. Server broadcasts action_update SSE
   ↓
10. Web dashboard shows action in list
   ↓
11. Loop continues until done, stopped, or limits reached
```

### Setup AI Assist

1. Open Desktop → Settings
2. Configure LLM Provider (currently OpenAI only)
3. Enter API Key (stored securely in OS keychain)
4. Click "Test Connection" to verify
5. From web dashboard, create run with Mode = "AI Assist"

### Security

- API keys are encrypted in OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret)
- Keys are never transmitted to the server
- Screenshots are only stored in memory on the server (60s expiry)
- Typed text is never logged or displayed

## Iteration 8: Workspace UI + Tool Timeline

### Features

1. **Desktop Workspace Configuration**
   - Settings includes a folder picker and clear action
   - Desktop shows a live workspace badge with the configured root name
   - Only `rootName` is shared with the server/web, never the absolute path

2. **Local Tool Approval**
   - AI-proposed workspace tools require explicit local approval
   - Tool approval UI shows tool name, relative path, or command name only
   - If no workspace is configured, desktop blocks tool approval and shows a warning banner

3. **Tool Observability**
   - API stores in-memory tool timeline metadata only
   - Web dashboard shows per-run tool events in real time
   - Tool events include status, timestamps, relative path or command name, and safe metadata like `exitCode`

### Privacy Model

- Absolute workspace paths are never sent to the server
- File contents are never sent to the server
- Terminal args are never sent to the server
- Terminal output stays local to the desktop UI

## Iteration 5: Remote Control (Safety-First)

### Features

1. **Structured Run Execution**
   - 4-step deterministic plan: Understand → Propose → Approve → Execute
   - Step statuses: pending → running → done/failed/blocked
   - Live log streaming per step

2. **Approval Workflow**
   - Server requests approval at any step
   - Desktop shows modal with title, description, risk level
   - User can approve/deny with comment
   - 10-minute timeout on approval requests

3. **Real-time Updates** (Web SSE)
   - Dashboard connects to `/events` SSE endpoint
   - Live run updates without polling

## Iteration 2: Device Pairing & Run Management

- Versioned WebSocket Protocol (v1)
- Device pairing with 8-character codes (10-min expiry)
- In-memory device and run storage

## Environment Variables

Copy `.env.example` to `.env.local` in each app directory:

### apps/api/.env.example
```
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_operator
JWT_SECRET=dev_secret_change_me
ACCESS_TOKEN_EXPIRES_IN=30m
REFRESH_TOKEN_TTL_DAYS=14
CSRF_COOKIE_NAME=csrf_token
ACCESS_COOKIE_NAME=access_token
REFRESH_COOKIE_NAME=refresh_token
WEB_ORIGIN=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_PRICE_ID=price_replace_me
APP_BASE_URL=http://localhost:3000
```

### apps/web/.env.example
```
NEXT_PUBLIC_API_BASE=http://localhost:3001
# Browser requests use credentials: "include"
```

### apps/desktop/.env.example
```
VITE_API_WS_URL=ws://localhost:3001/ws
```

## Protocol Documentation

See [docs/protocol.md](docs/protocol.md) for detailed WebSocket message specifications.

## Important Notes

1. **Desktop runs locally**: The desktop app must run on your local machine, not in a remote container, because it requires system permissions for screen capture (and future input injection).

2. **Persistence scope**: Devices, runs, actions, and tool timelines persist in Postgres. Screen frames are still in-memory only.

3. **Cookie auth is still MVP-grade**: Browser auth now uses rotating refresh tokens plus double-submit CSRF protection. Cookies are `Secure` only in production, and `SameSite=Lax` still means this should be deployed from the same site or a tightly controlled allowlist.

4. **Stripe billing**: Web billing uses a single recurring Stripe price (`STRIPE_PRICE_ID`). Stripe webhooks must reach the API to activate subscriptions and unlock automation.

5. **Deterministic agent**: The current "AI" is a deterministic stub that follows a fixed 4-step plan.

6. **Desktop token storage**: The desktop `deviceToken` now lives in the OS keychain. LLM API keys remain local-only and are never sent to the server.

## Stripe CLI

For local webhook testing, run:

```bash
stripe listen --forward-to localhost:3001/billing/webhook
stripe trigger customer.subscription.updated
```

## Demo: Screen Preview

1. Start API server: `pnpm --filter api dev`
2. Start web dashboard: `pnpm --filter web dev`
3. Start desktop app locally: `pnpm --filter desktop dev`
4. In desktop: Click "Request Pairing Code"
5. In web dashboard: Enter the code to pair the device
6. In desktop: Enable "Share Screen Preview" toggle
7. In web dashboard: Click "View Screen" on the device
8. See live screen preview updating in real-time!

**macOS users**: Grant Screen Recording permission when prompted.
