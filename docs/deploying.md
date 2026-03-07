# Deploying AI Operator (MVP Production Blueprint)

This document describes a production-ready MVP deployment for:
- `apps/api` (Fastify API + WS + SSE)
- `apps/web` (Next.js)
- Postgres
- Redis

## Supported Topology

Recommended MVP topology:
- Single API instance
- Single Web instance
- Shared Postgres
- Shared Redis

Why:
- WS device sockets are instance-local.
- Redis presence/rate limits are cross-instance, but do not make WS stateless.
- Single API instance avoids WS/SSE routing complexity during MVP.

If you scale API horizontally later, use sticky routing (or a dedicated WS gateway) so `/ws` and related device traffic stays pinned.

## Files Added in Iteration 21

- `docker-compose.prod.yml` - prod-like stack with migrate job
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `apps/api/scripts/migrate.sh`
- `infra/nginx/nginx.conf` - reverse proxy config for web/api/ws/sse
- `infra/monitoring/prometheus.yml`
- `infra/monitoring/alert.rules.yml`
- `infra/grafana/dashboards/api-overview.json`
- `.env.prod.example`

## Environment Setup

1. Copy env template:

```bash
cp .env.prod.example .env.prod
```

2. Edit `.env.prod` and set at minimum:
- `DATABASE_URL`
- `REDIS_URL`
- `WEB_ORIGIN`
- `APP_BASE_URL`
- `API_PUBLIC_BASE_URL`
- `JWT_SECRET`
- `ADMIN_API_KEY`
- Stripe vars if billing enabled

3. Keep these secure:
- `JWT_SECRET`
- `ADMIN_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Never commit `.env.prod`.

## Migrations Strategy (Production)

Production uses Prisma deploy-mode migrations:
- `prisma migrate deploy`
- never `prisma migrate dev`

`docker-compose.prod.yml` uses a separate one-off `migrate` service that must complete before API starts.

Manual run:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm migrate
```

## Run the Stack

Build images:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build
```

Start core stack:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres redis migrate api web
```

Start with edge proxy (nginx):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile edge up -d
```

Start monitoring profile:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile monitoring up -d
```

## Health and Metrics Checks

API readiness:

```bash
curl -i http://localhost:3001/ready
```

API metrics (default protected):

```bash
curl -i -H "x-admin-api-key: $ADMIN_API_KEY" http://localhost:3001/metrics
```

If `METRICS_PUBLIC=true`, `/metrics` is accessible without admin key.
Only use that on private internal networks.

## Prometheus + Alerts

`infra/monitoring/prometheus.yml` scrapes `api:3001/metrics`.

`infra/monitoring/alert.rules.yml` includes:
- `ApiHigh5xxRate`
- `ApiReadinessFailing`
- `WsConnectionsDropped`
- `StripeWebhookFailures`

## Reverse Proxy Notes (WS/SSE)

`infra/nginx/nginx.conf` provides:
- `/` -> web
- `/api/` -> api
- `/ws` with upgrade headers
- `/events` with buffering disabled for SSE

For MVP, still run one API instance unless you add explicit sticky routing and validate behavior under reconnect/restarts.

## Cloud-Friendly Option (Render/Fly/Hetzner)

This stack maps cleanly to common providers:

- API container: `apps/api/Dockerfile`
- Web container: `apps/web/Dockerfile`
- Managed Postgres + Redis
- Optional edge proxy/load balancer with sticky sessions for WS/SSE when scaling API

Provider-agnostic checklist:
1. Run migrate job before API rollout.
2. Route readiness probes to `/ready`.
3. Keep `/metrics` private (admin header or private network).
4. Use shared Redis for rate limits/presence.
5. Back up Postgres and test restore.

## Backups (Minimum)

- Daily Postgres logical backups (`pg_dump`)
- Prefer WAL/PITR if your platform supports it
- Test restore procedure regularly in non-production

## Security Notes

- Do not expose `METRICS_PUBLIC=true` on the public internet.
- Keep `ADMIN_API_KEY` private.
- Keep screenshot handling memory-only (no disk/database persistence).
- Keep local approval model unchanged for control/tool actions.
