# Render + Vercel Deployment Prep Design

## Goal

Prepare the existing monorepo for production deployment with:

- `apps/api` deployed to Render as a Docker-based web service
- `apps/web` deployed to Vercel with dashboard configuration and `apps/web` as the project root
- no runtime auth or security regressions
- no secrets committed to the repository

## Current Context

The repository already has a production-oriented container path:

- `apps/api/Dockerfile` builds and runs the API from the monorepo
- `apps/web/Dockerfile` supports containerized web deploys
- `docker-compose.prod.yml` models a production-like topology with Postgres, Redis, migrate, API, and web
- `docs/deploying.md` documents the provider-agnostic container deployment path

The API already satisfies the most important Render runtime assumptions:

- it reads `PORT`
- it binds to `0.0.0.0`
- it exposes `/ready` for readiness checks

## Deployment Approach

### Backend

Use Render `runtime: docker` with the existing `apps/api/Dockerfile` and the full repository as the Docker build context.

Why:

- the monorepo build shape is already encoded in the Dockerfile
- Prisma generation is already part of the API image build path
- this avoids duplicating monorepo install/build logic in Render-native build commands
- it keeps deployment behavior close to the existing production-compose path

### Frontend

Use Vercel dashboard configuration only:

- import the full monorepo
- set the Vercel project Root Directory to `apps/web`
- do not add `vercel.json` unless inspection reveals a concrete need

Why:

- the web app is already a standard Next.js app
- Vercel’s monorepo flow supports project-level root directory configuration
- file-based Vercel config is unnecessary for the requested deployment shape

### Migrations

Use a separate explicit migration step instead of startup migrations.

Preferred strategy:

- Render one-off job based on the API service image/environment
- run a deterministic non-interactive Prisma deploy command before or during rollout

Do not fold migrations into normal application startup.

Reasoning:

- startup remains simple and predictable
- migration failure does not become a boot-loop problem
- it matches the repository’s existing production-compose design, which separates `migrate` from `api`

## Files To Add or Update

### New

- `render.yaml`
- `docs/render-backend.md`
- `docs/vercel-frontend.md`
- `docs/deploy-render-vercel.md`
- `docs/plans/2026-03-08-render-vercel-deployment-prep.md`

### Likely updates

- `package.json` for optional Render helper scripts
- `docs/deploying.md` to point to the new provider-specific guide
- `README.md` to point to the new provider-specific guide
- `.dockerignore` to keep the Render Docker context fast and clean while still using the full repo as context

## Auth and Domain Model

Keep the existing auth/security model unchanged:

- cookie auth remains the browser auth mechanism
- refresh-token rotation remains unchanged
- CSRF protection remains unchanged
- approvals remain local to desktop/runtime as today
- screenshots remain memory-only
- no server-side LLM key storage is introduced

Recommended final topology:

- `app.<domain>` -> Vercel
- `api.<domain>` -> Render

Initial bring-up/testing can use:

- `*.vercel.app`
- `*.onrender.com`

but that is documented as transitional rather than the preferred final auth topology.

## Verification Plan

Because this work is intended to be deployment prep only, verification focuses on existing repo gates:

- `pnpm -w build`
- `pnpm -w typecheck`
- `pnpm -w test`
- `pnpm check:desktop:security`
- `pnpm smoke:final`

If `smoke:final` remains tied to local infrastructure, document that limitation instead of changing the smoke path.
