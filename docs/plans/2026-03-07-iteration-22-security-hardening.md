# Iteration 22 Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden API security defaults, close CSRF gaps, add secrets/logging guardrails, implement DB retention cleanup, and document the production security posture.

**Architecture:** Keep the current monolith structure but centralize cross-cutting security behavior into focused API library modules. Extend configuration validation and periodic background maintenance inside the API runtime, while covering the new behavior with test-first route-level and library-level tests.

**Tech Stack:** Fastify, Prisma, TypeScript, Node test runner, pnpm, Tauri/Next.js docs integration.

---

### Task 1: Record the Security Surfaces

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/lib/auth.ts`
- Review: `apps/api/src/config.ts`
- Review: `apps/api/prisma/schema.prisma`

**Step 1: Confirm existing hooks and route groups**
Run: `grep -nE "fastify\.(get|post|put|patch|delete)|addHook" apps/api/src/index.ts`
Expected: route and hook locations for headers, CSRF, auth/session endpoints, webhook endpoint.

**Step 2: Confirm cookie behavior and startup config**
Run: `sed -n '1,260p' apps/api/src/lib/auth.ts && sed -n '1,260p' apps/api/src/config.ts`
Expected: current cookie flags, CSRF exclusions, env parsing.

### Task 2: Add the Failing Security Tests

**Files:**
- Modify: `tests/api-auth.test.mjs`
- Modify: `apps/api/test/http-gates.test.mjs`
- Create: `tests/api-redact.test.mjs`
- Create: `tests/api-retention.test.mjs`
- Create: `tests/api-security.test.mjs`

**Step 1: Write CSRF route audit tests**
Add tests that enumerate representative cookie-auth mutation routes and assert `shouldCheckCsrf()` returns `true`, while bearer-auth variants and `/billing/webhook` stay exempt.

**Step 2: Write header/cache-control tests**
Add tests around a small Fastify harness using the new security middleware to prove headers and `Cache-Control: no-store` behavior.

**Step 3: Write redaction tests**
Add tests that pass nested token/secret/password/key-shaped payloads into the new redaction helper and assert masked output.

**Step 4: Write retention tests**
Add tests that validate the retention cutoff calculations and Prisma deleteMany filters without needing a real database.

**Step 5: Run the new tests to verify RED**
Run: `pnpm --filter @ai-operator/api build && node --test tests/api-auth.test.mjs tests/api-security.test.mjs tests/api-redact.test.mjs tests/api-retention.test.mjs apps/api/test/http-gates.test.mjs`
Expected: failures for missing helper/module behavior.

### Task 3: Implement Security Middleware and Config Guardrails

**Files:**
- Create: `apps/api/src/lib/security.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/lib/auth.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/.env.example`

**Step 1: Add centralized security helpers**
Implement security header application, sensitive-response cache policy, body-size defaults, and webhook raw body guardrails in `apps/api/src/lib/security.ts`.

**Step 2: Wire middleware into Fastify**
Replace inline header hooks in `apps/api/src/index.ts` with the centralized helper so behavior is consistent on every route.

**Step 3: Tighten cookies and startup validation**
In `apps/api/src/lib/auth.ts` and `apps/api/src/config.ts`, keep access/refresh cookies `HttpOnly`, keep CSRF non-HttpOnly, enforce secure cookies in production, and reject insecure `APP_BASE_URL`/`WEB_ORIGIN` unless `ALLOW_INSECURE_DEV=true`.

**Step 4: Add retention envs to example config**
Document retention defaults in `apps/api/.env.example`.

**Step 5: Re-run focused tests to verify GREEN**
Run: `pnpm --filter @ai-operator/api build && node --test tests/api-auth.test.mjs tests/api-security.test.mjs apps/api/test/http-gates.test.mjs`
Expected: pass.

### Task 4: Implement Redaction Guardrails

**Files:**
- Create: `apps/api/src/lib/redact.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/lib/ws-handler.ts`
- Modify: `apps/api/src/lib/auth.ts` (if helper usage is needed)
- Modify: `tests/api-redact.test.mjs`

**Step 1: Implement generic redaction**
Create `redact()` that recursively masks sensitive keys and strips authorization/cookie-like headers.

**Step 2: Apply redaction at API log boundaries**
Use the helper anywhere request/action/tool payloads or arbitrary objects could be logged.

**Step 3: Re-run redaction tests**
Run: `pnpm --filter @ai-operator/api build && node --test tests/api-redact.test.mjs`
Expected: pass.

### Task 5: Implement Retention Scheduler

**Files:**
- Create: `apps/api/src/lib/retention.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `tests/api-retention.test.mjs`

**Step 1: Implement one-shot retention cleanup**
Create `runRetentionOnce(prisma)` that deletes expired audit events, stripe event ids, stale sessions, and terminal runs using configurable day cutoffs.

**Step 2: Implement scheduler bootstrap**
Create `startRetentionScheduler()` with hourly interval, skip during tests, and allow manual one-shot execution for verification.

**Step 3: Wire scheduler into API startup**
Start it from `apps/api/src/index.ts` after Prisma/bootstrap is ready.

**Step 4: Re-run retention tests**
Run: `pnpm --filter @ai-operator/api build && node --test tests/api-retention.test.mjs`
Expected: pass.

### Task 6: Document the Security Posture

**Files:**
- Create: `docs/security.md`
- Modify: `docs/deploying.md`
- Modify: `README.md`

**Step 1: Write threat model and mitigations**
Document attacker goals, remote-control trust boundaries, secret handling constraints, and the “no screenshot persistence” rule.

**Step 2: Link docs from deployment and root readme**
Add concise references so production operators find the security guidance.

### Task 7: Full Verification

**Files:**
- Verify only

**Step 1: Build**
Run: `pnpm -w build`
Expected: exit 0.

**Step 2: Typecheck**
Run: `pnpm -w typecheck`
Expected: exit 0.

**Step 3: Test**
Run: `pnpm -w test`
Expected: exit 0.

**Step 4: Record verification commands for the user**
Include exact commands for one-shot retention execution, CSRF coverage tests, and production config validation.
