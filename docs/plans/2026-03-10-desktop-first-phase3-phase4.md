# Desktop-First Phase 3 And Phase 4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the desktop-first migration by treating desktop as a first-class account/device client, demoting the web dashboard to account/device/admin usage, and adding the migration/sign-in docs.

**Architecture:** Reuse the existing `Device`, `deviceToken`, `Run`, and browser-auth model. Add the smallest desktop-authenticated account/device management APIs needed for the desktop app, reshape the web dashboard into a desktop-first shell while keeping legacy tools behind a clearly labeled admin/debug surface, and add explicit migration docs without deleting legacy backend endpoints.

**Tech Stack:** Fastify, Prisma/Postgres, Next.js App Router, Tauri + React, TypeScript, Node test runner, existing repo smoke/security gates.

---

### Task 1: Lock Down Phase 3/4 Regression Tests

**Files:**
- Create: `tests/api-desktop-device-management.test.mjs`
- Create: `tests/web-dashboard-desktop-first.test.mjs`
- Create: `tests/docs-desktop-migration.test.mjs`
- Modify: `tests/desktop-task-surface.test.mjs`

**Step 1: Write the failing API/device-management test**

Write tests that assert:
- desktop-authenticated account/device bootstrap exposes per-device session/account data
- remote device revoke capability is wired for account/device management flows
- desktop-authenticated routes continue to use `requireDesktopDeviceSession(...)`

**Step 2: Run the new API test to verify it fails**

Run: `node tests/api-desktop-device-management.test.mjs`
Expected: FAIL because the new route/helper does not exist yet.

**Step 3: Write the failing web dashboard posture test**

Write tests that assert:
- main dashboard no longer exposes pairing and run creation as primary content
- dashboard includes desktop-first messaging, downloads/account/billing/device management
- legacy tools are present only in a clearly labeled `Admin / Legacy Tools` area or linked route

**Step 4: Run the web dashboard posture test to verify it fails**

Run: `node tests/web-dashboard-desktop-first.test.mjs`
Expected: FAIL because current dashboard still exposes pairing/run creation directly.

**Step 5: Write the failing docs/migration test**

Write tests that assert:
- `docs/desktop-signin-flow.md` exists and mentions browser sign-in, loopback callback, handoff token, single-use exchange, and sign-out/revoke
- `docs/migration-pairing-to-signin.md` exists and explains desktop-first migration plus legacy web fallback posture

**Step 6: Run the docs test to verify it fails**

Run: `node tests/docs-desktop-migration.test.mjs`
Expected: FAIL because the docs do not exist yet.

**Step 7: Commit**

```bash
git add tests/api-desktop-device-management.test.mjs tests/web-dashboard-desktop-first.test.mjs tests/docs-desktop-migration.test.mjs tests/desktop-task-surface.test.mjs
git commit -m "test: add desktop-first phase 3 and 4 coverage"
```

### Task 2: Add Desktop Account And Device Management APIs

**Files:**
- Create: `apps/api/src/lib/desktop-account.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/repos/devices.ts`
- Modify: `apps/api/src/repos/users.ts`
- Test: `tests/api-desktop-device-management.test.mjs`

**Step 1: Write the minimal backend helper**

Add a helper that gathers:
- current user/account snapshot
- current desktop device snapshot
- optionally sibling owned desktops for account/device management UI

Keep it read-only unless the step explicitly adds revoke behavior.

**Step 2: Add a focused desktop/account bootstrap or device-management route**

Implement the smallest route set needed for desktop-first account/device management, for example:
- `GET /desktop/account`
- `GET /desktop/devices`
- `POST /desktop/devices/:deviceId/revoke`

Rules:
- desktop-authenticated routes use bearer `deviceToken`
- browser-auth/account routes may coexist separately
- revoking one device must not revoke sibling desktop sessions

**Step 3: Reuse existing ownership and token revoke plumbing**

Use:
- `devicesRepo.findByDeviceToken(...)`
- `devicesRepo.revokeDeviceSession(...)`
- current ownership helpers

Do not create a second session system.

**Step 4: Run the focused API test**

Run: `node tests/api-desktop-device-management.test.mjs`
Expected: PASS

**Step 5: Run package build/typecheck**

Run:
- `pnpm --filter @ai-operator/api build`
- `pnpm --filter @ai-operator/api typecheck`

Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/lib/desktop-account.ts apps/api/src/index.ts apps/api/src/repos/devices.ts apps/api/src/repos/users.ts tests/api-desktop-device-management.test.mjs
git commit -m "feat: add desktop account and device management APIs"
```

### Task 3: Promote Desktop Account/Device Management In The Desktop App

**Files:**
- Create: `apps/desktop/src/lib/desktopAccount.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/lib/desktopTasks.ts`
- Modify: `apps/desktop/src/lib/taskReadiness.ts` (only if the new account/device state requires it)
- Test: `tests/desktop-task-surface.test.mjs`

**Step 1: Write the minimal desktop client helper**

Add a typed helper for the new desktop account/device management route(s).

It should fetch only what the desktop needs to display:
- signed-in account info
- current desktop device info
- other signed-in desktops if exposed
- revoke/sign-out targets if exposed

**Step 2: Add the smallest desktop UI surface**

In the existing desktop shell, add:
- account/device section
- explicit current desktop session info
- optional signed-in desktops list if returned
- device/session management action(s) that fit the current migration phase

Do not rewrite the run/task surface.

**Step 3: Keep security posture intact**

Ensure:
- no token logging
- no LLM key movement server-side
- no screenshot persistence changes
- local approvals remain unchanged

**Step 4: Run the desktop task surface tests**

Run:
- `node tests/desktop-task-surface.test.mjs`
- `pnpm --filter @ai-operator/desktop typecheck`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/desktopAccount.ts apps/desktop/src/App.tsx apps/desktop/src/lib/desktopTasks.ts apps/desktop/src/lib/taskReadiness.ts tests/desktop-task-surface.test.mjs
git commit -m "feat: add desktop account and device management surface"
```

### Task 4: Demote The Web Dashboard To Desktop-First Shell + Legacy Tools

**Files:**
- Create: `apps/web/app/dashboard/legacy/page.tsx` or `apps/web/app/dashboard/components/LegacyTools.tsx`
- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/lib/auth.ts` only if the new dashboard shell needs additional fetch helpers
- Test: `tests/web-dashboard-desktop-first.test.mjs`

**Step 1: Move legacy controls out of the primary dashboard surface**

Primary dashboard should emphasize:
- desktop download/install
- billing/account status
- signed-in devices/desktops
- device management
- explicit instruction that tasks start from the desktop app

Legacy-only content should include:
- pairing UI
- web run creation UI
- anything dashboard-first/operator-centric that is still needed for admin/debug fallback

**Step 2: Label legacy tools clearly**

Use text such as:
- `Admin / Legacy Tools`
- `Migration fallback`
- `Use only for debug or older desktop builds`

Do not remove the backend endpoints yet.

**Step 3: Preserve fallback usefulness**

The legacy area must still work for:
- debug
- migration
- older clients

But it must not dominate the primary dashboard.

**Step 4: Run the web dashboard posture test**

Run:
- `node tests/web-dashboard-desktop-first.test.mjs`
- `pnpm --filter @ai-operator/web build`
- `pnpm --filter @ai-operator/web typecheck`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/app/dashboard/page.tsx apps/web/app/dashboard/legacy/page.tsx apps/web/lib/auth.ts tests/web-dashboard-desktop-first.test.mjs
git commit -m "feat: demote dashboard-first tools behind legacy admin UI"
```

### Task 5: Add Migration And Sign-In Documentation

**Files:**
- Create: `docs/desktop-signin-flow.md`
- Create: `docs/migration-pairing-to-signin.md`
- Modify: `docs/plans/desktop-first-auth-and-task-flow.md`
- Test: `tests/docs-desktop-migration.test.mjs`

**Step 1: Document the desktop sign-in flow**

Include:
- system browser requirement
- loopback callback pattern
- handoff token issuance/exchange
- single-use + short-lived token constraints
- durable device token storage
- sign-out and revoke behavior

**Step 2: Document the pairing-to-sign-in migration**

Include:
- why pairing is no longer primary
- what remains available in legacy web tools
- multi-device policy
- how older desktops continue to work during migration

**Step 3: Update the main plan doc**

Add a short “implemented state” note so the repo docs reflect:
- Phase 1 complete
- Phase 2 complete
- Phase 3/4 posture implemented in this pass

**Step 4: Run docs tests**

Run: `node tests/docs-desktop-migration.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/desktop-signin-flow.md docs/migration-pairing-to-signin.md docs/plans/desktop-first-auth-and-task-flow.md tests/docs-desktop-migration.test.mjs
git commit -m "docs: add desktop sign-in and migration guidance"
```

### Task 6: Final Verification

**Files:**
- Verify staged changes only

**Step 1: Run focused regression checks**

Run:
- `node tests/api-desktop-device-management.test.mjs`
- `node tests/web-dashboard-desktop-first.test.mjs`
- `node tests/docs-desktop-migration.test.mjs`
- `node tests/desktop-task-surface.test.mjs`

Expected: PASS

**Step 2: Run required package checks**

Run:
- `pnpm --filter @ai-operator/api build`
- `pnpm --filter @ai-operator/desktop build`
- `pnpm --filter @ai-operator/desktop typecheck`
- `pnpm --filter @ai-operator/web build`
- `pnpm --filter @ai-operator/web typecheck`

Expected: PASS

**Step 3: Run repo-wide required gates**

Run:
- `pnpm -w build`
- `pnpm -w typecheck`
- `pnpm -w test`
- `pnpm check:desktop:security`
- `pnpm smoke:final`

Expected: PASS

**Step 4: Commit**

```bash
git add .
git commit -m "chore: finish desktop-first migration posture"
```
