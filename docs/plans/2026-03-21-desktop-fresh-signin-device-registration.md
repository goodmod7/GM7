# Desktop Fresh Sign-In Device Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix fresh-install desktop browser sign-in so it succeeds without a pre-existing persisted device row.

**Architecture:** The desktop will register itself early by opening the unsigned WebSocket on startup, and the API will treat missing persisted rows as recoverable by upserting during device claim. This preserves the existing auth handoff model while removing the hidden dependency on prior pairing or prior socket registration.

**Tech Stack:** React, TypeScript, Fastify, Prisma, Tauri, Node test runner

---

### Task 1: Add regression tests for the fresh-install path

**Files:**
- Modify: `tests/desktop-auth-flow.test.mjs`
- Modify: `tests/api-desktop-auth-routes.test.mjs`

**Step 1: Write the failing tests**

- In `tests/desktop-auth-flow.test.mjs`, add assertions that:
  - the desktop startup path connects the `WsClient` without wrapping the connect call in a `deviceToken` gate
  - desktop sign-in disconnects and reconnects after storing the exchanged token
- In `tests/api-desktop-auth-routes.test.mjs`, add an assertion that `claimDevice` uses an upsert-backed persistence path so exchange can recover from a missing row

**Step 2: Run the tests to verify they fail**

Run: `node --test tests/desktop-auth-flow.test.mjs tests/api-desktop-auth-routes.test.mjs`

Expected: FAIL because startup still gates socket connect on `deviceToken`, sign-in does not force reconnect, and `claimDevice` still uses `update`.

### Task 2: Make desktop startup register unsigned devices

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `tests/desktop-auth-flow.test.mjs`

**Step 1: Write the minimal implementation**

- Change startup so `wsClient.connect(runtimeConfig.wsUrl)` runs after client creation even when there is no stored token
- Keep the existing token-loading logic intact

**Step 2: Make post-sign-in reconnect explicit**

- In `handleDesktopSignIn`, after storing and setting the new token:
  - set the token on the client
  - disconnect the existing unsigned socket
  - reconnect so `device.hello` carries the durable token

**Step 3: Run the desktop auth regression test**

Run: `node --test tests/desktop-auth-flow.test.mjs`

Expected: PASS

### Task 3: Make backend device claim recover from missing rows

**Files:**
- Modify: `apps/api/src/repos/devices.ts`
- Modify: `apps/api/src/index.ts`
- Test: `tests/api-desktop-auth-routes.test.mjs`

**Step 1: Update `claimDevice` to use `prisma.device.upsert(...)`**

- Keep the update path behavior the same for existing rows
- Add a create path with safe defaults for a fresh record:
  - `id`
  - `ownerUserId`
  - `platform: 'unknown'`
  - `lastSeenAt: now`
  - token/session metadata fields

**Step 2: Remove the exchange-route hard stop**

- Delete the `/desktop/auth/exchange` precheck that returns `Device not found`
- Let the route claim the device directly through the upsert-capable repo method

**Step 3: Run the API regression test**

Run: `node --test tests/api-desktop-auth-routes.test.mjs`

Expected: PASS

### Task 4: Verify focused regression coverage

**Files:**
- Test: `tests/api-desktop-auth.test.mjs`
- Test: `tests/api-desktop-auth-routes.test.mjs`
- Test: `tests/desktop-auth-flow.test.mjs`
- Test: `tests/web-desktop-signin.test.mjs`

**Step 1: Run focused auth/sign-in tests**

Run: `node --test tests/api-desktop-auth.test.mjs tests/api-desktop-auth-routes.test.mjs tests/desktop-auth-flow.test.mjs tests/web-desktop-signin.test.mjs`

Expected: PASS

**Step 2: Run desktop typecheck**

Run: `pnpm --filter @ai-operator/desktop typecheck`

Expected: PASS

### Task 5: Final verification

**Files:**
- Verify only

**Step 1: Re-run the focused regression command fresh**

Run: `node --test tests/api-desktop-auth.test.mjs tests/api-desktop-auth-routes.test.mjs tests/desktop-auth-flow.test.mjs tests/web-desktop-signin.test.mjs`

Expected: PASS

**Step 2: Re-run desktop typecheck fresh**

Run: `pnpm --filter @ai-operator/desktop typecheck`

Expected: PASS
