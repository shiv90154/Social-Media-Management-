# Builds and runs the BullMQ worker (apps/worker) from the full monorepo.
FROM node:20-alpine AS base
# ffmpeg/ffprobe are needed by @smm/storage's video probing helper.
RUN apk add --no-cache libc6-compat python3 make g++ ffmpeg
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
RUN pnpm --filter @smm/worker run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /repo /repo
CMD ["pnpm", "--filter", "@smm/worker", "run", "start"]
