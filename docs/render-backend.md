# Render Backend Deployment

This repository is prepared for Render backend deployment using Docker only.

## Recommended Render Service Settings

- Service type: `Web Service`
- Runtime: `Docker`
- Dockerfile path: `apps/api/Dockerfile`
- Docker build context: `.`
- Health check path: `/ready`
- Region: choose the same region as your Postgres and Redis providers

Do not deploy the frontend on Render in this setup. `apps/web` stays on Vercel.

## Render Blueprint

The repo includes a root [render.yaml](/workspaces/GM7/render.yaml) that defines the Docker web service for the API.

It keeps the Render topology simple:

- startup runs `prisma migrate deploy` before the API process
- no frontend service
- `/ready` as the health check

## Migration Strategy

The Docker startup path now runs `prisma migrate deploy` before booting the API. That removes the first-deploy failure mode where Render starts the container against an empty database.

You can still use a separate explicit migration step when you want tighter rollout control.

Recommended Render rollout flow:

1. Create or sync the API service from `render.yaml`.
2. Add environment variables.
3. Trigger an image build/deploy.
4. Optional but recommended for controlled rollouts: run a one-off job against the API service image with:

```bash
pnpm render:api:migrate
```

Expanded command:

```bash
pnpm --filter @ai-operator/api prisma:generate && pnpm --filter @ai-operator/api migrate:deploy
```

5. After the deploy is healthy, verify:
   - `GET /health`
   - `GET /ready`

## Environment Variables

### Required on Render

- `DATABASE_URL`
  - Managed Postgres connection string
- `REDIS_URL`
  - Shared Redis connection string
- `JWT_SECRET`
  - Strong random secret
- `ADMIN_API_KEY`
  - Strong random admin key for `/admin/health` and `/metrics`
- `WEB_ORIGIN`
  - Final frontend origin, for example `https://app.example.com`
- `APP_BASE_URL`
  - Final frontend origin, for example `https://app.example.com`
- `API_PUBLIC_BASE_URL`
  - Final API origin, for example `https://api.example.com`
- `GITHUB_REPO_OWNER`
  - GitHub owner used for desktop release metadata in `github` mode
- `GITHUB_REPO_NAME`
  - GitHub repo name used for desktop release metadata in `github` mode

### Strongly Recommended Explicit Values

- `NODE_ENV=production`
- `DEPLOYMENT_MODE=single_instance`
- `RATE_LIMIT_BACKEND=redis`
- `METRICS_PUBLIC=false`
- `BILLING_ENABLED=false`
- `DESKTOP_RELEASE_SOURCE=github`
- `DESKTOP_RELEASE_TAG=v0.1.0-beta.1`
- `RUN_RECOVERY_POLICY=fail`
- `ALLOW_INSECURE_DEV=false`

### Optional

- `GITHUB_TOKEN`
  - Only required if the GitHub repo is private or you need higher API limits
- `LOG_LEVEL`
  - Default `info`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`
  - Only needed when `BILLING_ENABLED=true`
- `DESKTOP_RELEASE_CACHE_TTL_SECONDS`
  - Default `60`
- `AUDIT_RETENTION_DAYS`
  - Default `30`
- `STRIPE_EVENT_RETENTION_DAYS`
  - Default `30`
- `SESSION_RETENTION_DAYS`
  - Default `30`
- `RUN_RETENTION_DAYS`
  - Default `90`

### Provided by Render

- `PORT`
  - Render injects this automatically
  - Do not hardcode it

## Recommended First-Deployment Values

For the initial production bring-up:

- `NODE_ENV=production`
- `RATE_LIMIT_BACKEND=redis`
- `METRICS_PUBLIC=false`
- `BILLING_ENABLED=false`
- `DESKTOP_RELEASE_SOURCE=github`
- `DESKTOP_RELEASE_TAG=v0.1.0-beta.1`
- `ALLOW_INSECURE_DEV=false`

## Startup Validation Notes

The API already matches Render’s container expectations:

- it binds to `0.0.0.0`
- it reads `PORT`
- it does not depend on local Docker networking
- `/ready` is the correct Render health check because it validates DB/schema/runtime readiness

Use `/health` only for basic liveness checks.
