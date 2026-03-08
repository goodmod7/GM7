# Render + Vercel Deployment Prep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add minimal, production-safe deployment prep for Render API deployment and Vercel web deployment without changing runtime auth/security behavior.

**Architecture:** Keep the API on the existing monorepo-aware Docker path, keep the web app on Vercel dashboard-driven monorepo configuration, and document an explicit migration step instead of startup migrations. Limit code changes to deployment config, helper scripts, and documentation unless a real deployment bug is discovered.

**Tech Stack:** pnpm workspace, Turbo, Fastify, Prisma, Next.js, Docker, Render Blueprint YAML, Vercel dashboard configuration

---

### Task 1: Add Render deployment config

**Files:**
- Create: `render.yaml`
- Modify: `.dockerignore`
- Modify: `package.json`

**Step 1: Add the root Render blueprint**

- Define one Docker `web` service only for the API.
- Use `apps/api/Dockerfile` as `dockerfilePath`.
- Use the full repository as `dockerContext`.
- Set `healthCheckPath` to `/ready`.
- Keep frontend deployment off Render.
- Keep migrations out of normal startup.

**Step 2: Add Docker context hygiene**

- Add a root `.dockerignore` that removes local build outputs, `node_modules`, `.git`, and other non-source artifacts from the Docker upload context.
- Do not exclude any files required by `apps/api/Dockerfile`.

**Step 3: Add optional Render helper scripts**

- Add root scripts only if they simplify docs and operator workflow:
  - `render:api:build`
  - `render:api:start`
  - `render:api:migrate`

**Step 4: Verify package metadata remains valid**

Run:

```bash
pnpm -w build
```

Expected:

- workspace still builds
- no script parsing issues

### Task 2: Add provider-specific deployment docs

**Files:**
- Create: `docs/render-backend.md`
- Create: `docs/vercel-frontend.md`
- Create: `docs/deploy-render-vercel.md`
- Modify: `docs/deploying.md`
- Modify: `README.md`

**Step 1: Write Render backend doc**

- Document the Render Docker service path.
- Mark env vars as mandatory vs optional.
- Document `/ready` as the health check.
- Document the explicit migration command and recommended one-off job flow.

**Step 2: Write Vercel frontend doc**

- Document monorepo import with Root Directory `apps/web`.
- Document `NEXT_PUBLIC_API_BASE`.
- Document the recommended sibling-subdomain topology.
- Explicitly note that Render remains the backend host.

**Step 3: Write the combined deployment guide**

- Document architecture, deployment order, smoke checks, and caveats.
- Include Neon Postgres and Upstash Redis as the recommended managed services.

**Step 4: Add discoverability links**

- Update the generic deployment doc and README so the new provider-specific guide is easy to find.

### Task 3: Verify no runtime regressions

**Files:**
- No targeted source change expected unless verification exposes a real bug

**Step 1: Run the full requested verification suite**

Run:

```bash
pnpm -w build
pnpm -w typecheck
pnpm -w test
pnpm check:desktop:security
pnpm smoke:final
```

**Step 2: Interpret failures conservatively**

- If a failure is caused by the new deployment-prep changes, fix it.
- If a failure is pre-existing or local-infrastructure-dependent, document it precisely.

**Step 3: Report exact operator inputs**

- Render service type
- Dockerfile path
- Docker context
- health check path
- migration command
- Vercel root directory
- Vercel env vars

### Task 4: Handle unexpected runtime bug only if discovered

**Files:**
- Only the smallest necessary runtime file(s)
- Matching test file(s) first

**Step 1: If verification reveals a real deployment bug, write a failing test first**

- Only applicable if a code/runtime issue is found.
- For docs/config-only changes, no new unit test is required.

**Step 2: Implement the minimal fix**

- Preserve current auth/security model.
- Avoid any desktop release behavior change unless required for deployment wiring.

**Step 3: Re-run the relevant failing command plus the full verification suite**

- Do not claim completion without fresh command output.
