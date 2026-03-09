# Deploying AI Operator on Render + Vercel

This guide describes the recommended production topology for this repository:

- GitHub source repository
- Render for `apps/api`
- Vercel for `apps/web`
- Neon Postgres
- Upstash Redis

Provider-specific details are split across:

- [docs/render-backend.md](/workspaces/GM7/docs/render-backend.md)
- [docs/vercel-frontend.md](/workspaces/GM7/docs/vercel-frontend.md)

## Recommended Architecture

- `app.<domain>` -> Vercel project rooted at `apps/web`
- `api.<domain>` -> Render Docker web service using `apps/api/Dockerfile`
- Neon Postgres -> `DATABASE_URL`
- Upstash Redis -> `REDIS_URL`

Keep the monorepo intact. Do not split the API and web apps into separate repositories.

## Deployment Order

1. Provision managed Postgres and Redis
2. Create the Render API service from the monorepo
3. Add backend env vars on Render
4. Deploy the Render API image
5. Let the API startup path apply Prisma migrations automatically
6. Optional: run the explicit migration step for controlled rollouts
7. Verify `GET /health` and `GET /ready`
8. Import the monorepo into Vercel with `apps/web` as Root Directory
9. Set `NEXT_PUBLIC_API_BASE`
10. Deploy the frontend
11. Attach custom domains
12. Test login, refresh/session behavior, dashboard, `/download`, and updater metadata

Deploy the backend first so the frontend always points at a live API.

## Custom Domains

Recommended final topology:

- `app.<domain>` -> Vercel
- `api.<domain>` -> Render

Initial testing can use:

- `*.vercel.app`
- `*.onrender.com`

Treat those provider-default domains as bring-up URLs, not the preferred final auth topology.

## Backend Setup Summary

- Render service type: `Web Service`
- Runtime: `Docker`
- Dockerfile path: `apps/api/Dockerfile`
- Docker build context: `.`
- Health check path: `/ready`
- Startup behavior: runs `prisma migrate deploy` before starting the API
- Optional explicit migration step:

```bash
pnpm render:api:migrate
```

## Frontend Setup Summary

- Vercel project root: `apps/web`
- Framework: `Next.js`
- Required env:

```bash
NEXT_PUBLIC_API_BASE=https://api.<your-domain>
```

## First Smoke Checks

Run these after both deployments are up:

- `GET /health`
- `GET /ready`
- register or log in through the web app
- confirm the dashboard loads
- open `/download`
- hit the desktop update metadata path through the API

Suggested checks:

- `https://api.<domain>/health`
- `https://api.<domain>/ready`
- `https://app.<domain>/login`
- `https://app.<domain>/dashboard`
- `https://app.<domain>/download`

If desktop release metadata is configured through GitHub:

- verify `/downloads/desktop`
- verify `/updates/desktop/:platform/:arch/:currentVersion.json`

## Known Caveats

- Redis is required for full queue reliability across API instances
- signed stable desktop releases provide the best install/update experience
- beta releases are acceptable for internal testing
- `BILLING_ENABLED=false` is the safest first deployment state unless Stripe is already configured
- custom sibling subdomains are preferred for cookie auth; provider-default hostnames are acceptable only for initial bring-up/testing
