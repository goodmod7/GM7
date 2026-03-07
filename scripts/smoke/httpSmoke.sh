#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SMOKE_ENV_FILE="${SMOKE_ENV_FILE:-/tmp/ai-operator-smoke.env}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/ai-operator-smoke.cookies.txt}"
API_LOG="${API_LOG:-/tmp/ai-operator-api.log}"
WEB_LOG="${WEB_LOG:-/tmp/ai-operator-web.log}"
API_PID_FILE="${API_PID_FILE:-/tmp/ai-operator-api.pid}"
WEB_PID_FILE="${WEB_PID_FILE:-/tmp/ai-operator-web.pid}"
API_BASE="${API_BASE:-http://localhost:3001}"
WEB_BASE="${WEB_BASE:-http://localhost:3000}"
ADMIN_API_KEY_VALUE="${ADMIN_API_KEY_VALUE:-smoke-admin-key}"
TEST_EMAIL_VALUE="${TEST_EMAIL_VALUE:-smoke-$(date +%s)@example.com}"
TEST_PASSWORD_VALUE="${TEST_PASSWORD_VALUE:-smoke-pass-123}"
DATABASE_URL_VALUE="${DATABASE_URL_VALUE:-postgresql://postgres:postgres@localhost:5432/ai_operator}"
SMOKE_MANAGE_INFRA="${SMOKE_MANAGE_INFRA:-1}"
SMOKE_START_WEB="${SMOKE_START_WEB:-1}"
SMOKE_MIGRATE_DEPLOY="${SMOKE_MIGRATE_DEPLOY:-0}"
CSRF_TOKEN_VALUE=""

cleanup_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

cleanup_process_pattern() {
  local pattern="$1"
  pkill -f "$pattern" >/dev/null 2>&1 || true
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-60}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      echo "Timed out waiting for $url" >&2
      return 1
    fi
    sleep 1
  done
}

wait_for_postgres() {
  local timeout_seconds="${1:-60}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if (
      cd "$ROOT_DIR/infra" &&
      docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1
    ); then
      return 0
    fi
    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      echo "Timed out waiting for postgres readiness" >&2
      return 1
    fi
    sleep 1
  done
}

extract_cookie_value() {
  local cookie_name="$1"
  awk -v name="$cookie_name" '
    BEGIN { FS = "\t" }
    /^#/ && $0 !~ /^#HttpOnly_/ { next }
    {
      if ($1 ~ /^#HttpOnly_/) {
        sub(/^#HttpOnly_/, "", $1)
      }
      if (NF >= 7 && $6 == name) {
        print $7
      }
    }
  ' "$COOKIE_JAR" | tail -n 1
}

set_subscription_status() {
  local status="$1"
  TEST_EMAIL="$TEST_EMAIL_VALUE" \
  SUBSCRIPTION_STATUS="$status" \
  DATABASE_URL="$DATABASE_URL_VALUE" \
  PRISMA_CLIENT_PATH="$ROOT_DIR/apps/api/node_modules/@prisma/client" \
  node --input-type=module <<'EOF'
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH);

const prisma = new PrismaClient();

try {
  await prisma.user.update({
    where: { email: process.env.TEST_EMAIL },
    data: { subscriptionStatus: process.env.SUBSCRIPTION_STATUS },
  });
} finally {
  await prisma.$disconnect();
}
EOF
}

if [[ "$SMOKE_MANAGE_INFRA" == "1" ]]; then
  echo "RESETTING_INFRA=1"
  (
    cd "$ROOT_DIR/infra"
    docker compose down -v >/dev/null 2>&1 || true
    docker compose up -d >/dev/null
  )

  wait_for_postgres 60
else
  echo "RESETTING_INFRA=0"
fi

echo "MIGRATING_DB=1"
(
  cd "$ROOT_DIR"
  export DATABASE_URL="$DATABASE_URL_VALUE"
  if [[ "$SMOKE_MIGRATE_DEPLOY" == "1" ]]; then
    pnpm --filter @ai-operator/api exec prisma migrate deploy >/tmp/ai-operator-prisma-migrate.log
  else
    pnpm --filter @ai-operator/api exec prisma migrate dev >/tmp/ai-operator-prisma-migrate.log
  fi
)

cleanup_pid_file "$API_PID_FILE"
cleanup_pid_file "$WEB_PID_FILE"
cleanup_process_pattern "tsx watch src/index.ts"
cleanup_process_pattern "tsx src/index.ts"
cleanup_process_pattern "node apps/api/dist/index.js"
cleanup_process_pattern "next dev"
rm -f "$COOKIE_JAR" "$SMOKE_ENV_FILE"

echo "STARTING_API=1"
(
  cd "$ROOT_DIR"
  export PORT=3001
  export NODE_ENV=development
  export LOG_LEVEL=info
  export DATABASE_URL="$DATABASE_URL_VALUE"
  export JWT_SECRET=smoke-jwt-secret
  export ACCESS_TOKEN_EXPIRES_IN=30m
  export REFRESH_TOKEN_TTL_DAYS=14
  export CSRF_COOKIE_NAME=csrf_token
  export ACCESS_COOKIE_NAME=access_token
  export REFRESH_COOKIE_NAME=refresh_token
  export WEB_ORIGIN=http://localhost:3000
  export STRIPE_SECRET_KEY=sk_test_smoke
  export STRIPE_WEBHOOK_SECRET=whsec_smoke
  export STRIPE_PRICE_ID=price_smoke
  export APP_BASE_URL=http://localhost:3000
  export API_PUBLIC_BASE_URL=http://localhost:3001
  export DESKTOP_UPDATE_FEED_DIR=./apps/api/updates
  export DESKTOP_UPDATE_ENABLED=true
  export DESKTOP_RELEASE_SOURCE=file
  export DESKTOP_VERSION=0.1.0
  export DESKTOP_WIN_URL=https://example.com/downloads/ai-operator-setup.exe
  export DESKTOP_MAC_INTEL_URL=https://example.com/downloads/ai-operator-macos-intel.dmg
  export DESKTOP_MAC_ARM_URL=https://example.com/downloads/ai-operator-macos-apple-silicon.dmg
  export ADMIN_API_KEY="$ADMIN_API_KEY_VALUE"
  pnpm --filter @ai-operator/api build >/tmp/ai-operator-api-build.log
  nohup node apps/api/dist/index.js >"$API_LOG" 2>&1 &
  echo $! >"$API_PID_FILE"
)

if [[ "$SMOKE_START_WEB" == "1" ]]; then
  echo "STARTING_WEB=1"
  (
    cd "$ROOT_DIR"
    export NEXT_PUBLIC_API_BASE=http://localhost:3001
    nohup pnpm --filter @ai-operator/web exec next dev -p 3000 >"$WEB_LOG" 2>&1 &
    echo $! >"$WEB_PID_FILE"
  )
else
  echo "STARTING_WEB=0"
fi

wait_for_http "$API_BASE/health" 60
if [[ "$SMOKE_START_WEB" == "1" ]]; then
  wait_for_http "$WEB_BASE/login" 90
fi

echo "REGISTERING_USER=1"
curl -fsS -X POST "$API_BASE/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL_VALUE\",\"password\":\"$TEST_PASSWORD_VALUE\"}" >/tmp/ai-operator-auth-register.json

echo "LOGGING_IN=1"
curl -fsS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$API_BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL_VALUE\",\"password\":\"$TEST_PASSWORD_VALUE\"}" >/tmp/ai-operator-auth-login.json

CSRF_TOKEN_VALUE="$(extract_cookie_value csrf_token)"
if [[ -z "$CSRF_TOKEN_VALUE" ]]; then
  echo "Missing csrf_token cookie" >&2
  exit 1
fi

if [[ -z "$(extract_cookie_value access_token)" ]]; then
  echo "Missing access_token cookie" >&2
  exit 1
fi

if [[ -z "$(extract_cookie_value refresh_token)" ]]; then
  echo "Missing refresh_token cookie" >&2
  exit 1
fi

RUNS_WITHOUT_CSRF_STATUS="$(curl -s -o /tmp/ai-operator-runs-no-csrf.json -w '%{http_code}' \
  -b "$COOKIE_JAR" \
  -X POST "$API_BASE/runs" \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"missing-device","goal":"missing csrf smoke","mode":"manual"}')"

if [[ "$RUNS_WITHOUT_CSRF_STATUS" != "403" ]]; then
  echo "Expected 403 without CSRF, got $RUNS_WITHOUT_CSRF_STATUS" >&2
  exit 1
fi

set_subscription_status inactive
DOWNLOADS_INACTIVE_STATUS="$(curl -s -o /tmp/ai-operator-downloads-inactive.json -w '%{http_code}' \
  -b "$COOKIE_JAR" \
  "$API_BASE/downloads/desktop")"

if [[ "$DOWNLOADS_INACTIVE_STATUS" != "402" ]]; then
  echo "Expected 402 for inactive downloads, got $DOWNLOADS_INACTIVE_STATUS" >&2
  exit 1
fi

set_subscription_status active
DOWNLOADS_ACTIVE_STATUS="$(curl -s -o /tmp/ai-operator-downloads-active.json -w '%{http_code}' \
  -b "$COOKIE_JAR" \
  "$API_BASE/downloads/desktop")"

if [[ "$DOWNLOADS_ACTIVE_STATUS" != "200" ]]; then
  echo "Expected 200 for active downloads, got $DOWNLOADS_ACTIVE_STATUS" >&2
  exit 1
fi

UPDATES_STATUS="$(curl -s -o /tmp/ai-operator-updates.json -w '%{http_code}' \
  "$API_BASE/updates/desktop/windows/x86_64/0.0.0.json")"

if [[ "$UPDATES_STATUS" != "200" ]]; then
  echo "Expected 200 for updates endpoint, got $UPDATES_STATUS" >&2
  exit 1
fi

node --input-type=module <<'EOF'
import { readFile } from 'node:fs/promises';

const payload = JSON.parse(await readFile('/tmp/ai-operator-updates.json', 'utf8'));
if (!payload.version || !payload.platforms) {
  process.stderr.write('Invalid updates manifest\n');
  process.exit(1);
}
EOF

ADMIN_STATUS="$(curl -s -o /tmp/ai-operator-admin-health.json -w '%{http_code}' \
  -H "x-admin-api-key: $ADMIN_API_KEY_VALUE" \
  "$API_BASE/admin/health")"

if [[ "$ADMIN_STATUS" != "200" ]]; then
  echo "Expected 200 for admin health, got $ADMIN_STATUS" >&2
  exit 1
fi

LOGIN_429=0
for _ in $(seq 1 12); do
  status="$(curl -s -o /tmp/ai-operator-bad-login.json -w '%{http_code}' \
    -X POST "$API_BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$TEST_EMAIL_VALUE\",\"password\":\"wrong-password\"}")"
  if [[ "$status" == "429" ]]; then
    LOGIN_429=1
    break
  fi
done

if [[ "$LOGIN_429" != "1" ]]; then
  echo "Did not observe auth login rate limit" >&2
  exit 1
fi

cat >"$SMOKE_ENV_FILE" <<EOF
TEST_EMAIL=$TEST_EMAIL_VALUE
TEST_PASSWORD=$TEST_PASSWORD_VALUE
COOKIE_JAR=$COOKIE_JAR
CSRF_TOKEN=$CSRF_TOKEN_VALUE
API_BASE=$API_BASE
WEB_BASE=$WEB_BASE
ADMIN_API_KEY=$ADMIN_API_KEY_VALUE
DATABASE_URL=$DATABASE_URL_VALUE
EOF

echo "TEST_EMAIL=$TEST_EMAIL_VALUE"
echo "CSRF_TOKEN=$CSRF_TOKEN_VALUE"
echo "ADMIN_HEALTH=OK"
echo "SUBSCRIPTION_GATING=OK"
echo "UPDATES_ENDPOINT=OK"
echo "AUTH_CSRF=OK"
echo "RATE_LIMIT=OK"
echo "SMOKE_ENV_FILE=$SMOKE_ENV_FILE"
echo "API_PID=$(cat "$API_PID_FILE")"
if [[ -f "$WEB_PID_FILE" ]]; then
  echo "WEB_PID=$(cat "$WEB_PID_FILE")"
else
  echo "WEB_PID="
fi
