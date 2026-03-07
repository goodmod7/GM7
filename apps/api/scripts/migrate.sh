#!/bin/sh
set -eu

pnpm --filter @ai-operator/api exec prisma generate
pnpm --filter @ai-operator/api exec prisma migrate deploy
