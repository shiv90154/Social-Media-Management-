# Builds and runs the Next.js app (apps/web) from the full monorepo.
# Simpler than a pruned/standalone build so the whole workspace's dependency
# graph (packages/*) resolves the same way it does in local dev.
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install

FROM deps AS builder
COPY . .
RUN pnpm --filter @smm/db run generate
RUN pnpm --filter @smm/web run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /repo /repo
EXPOSE 3000
CMD ["pnpm", "--filter", "@smm/web", "run", "start"]
