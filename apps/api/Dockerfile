FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm -r install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @ai-operator/shared build
RUN pnpm --filter @ai-operator/api exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter @ai-operator/api build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/shared ./packages/shared
RUN ln -s /app/node_modules /app/apps/api/node_modules
EXPOSE 3001
CMD ["pnpm", "--filter", "@ai-operator/api", "start"]
