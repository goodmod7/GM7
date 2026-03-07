FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm -r install --frozen-lockfile

FROM deps AS build
ENV NEXT_DISABLE_ESLINT=1
COPY . .
RUN pnpm --filter @ai-operator/web build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
EXPOSE 3000
CMD ["pnpm", "--filter", "@ai-operator/web", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
