import { config } from "dotenv";
import { resolve } from "node:path";
import { Worker, type Job } from "bullmq";

// Docker Compose injects env vars directly; this only matters for `pnpm dev`
// outside a container, where nothing else loads the repo-root .env file.
config({ path: resolve(__dirname, "../../../.env") });
import {
  QUEUE_NAMES,
  getRedisConnection,
  scheduleRepeatingAnalyticsSweep,
  scheduleRepeatingTokenRefreshSweep,
  type PublishPostJobData,
  type RefreshTokenJobData,
  type FetchAnalyticsJobData,
} from "@smm/queue";
import { processPublishPost } from "./processors/publishPost";
import { processRefreshTokenJob, processRefreshTokenSweep } from "./processors/refreshTokens";
import { processAnalyticsSweep } from "./processors/fetchAnalytics";

const connection = getRedisConnection();

const publishWorker = new Worker<PublishPostJobData>(
  QUEUE_NAMES.publishPost,
  async (job) => processPublishPost(job),
  { connection, concurrency: 5 },
);

const refreshWorker = new Worker<RefreshTokenJobData>(
  QUEUE_NAMES.refreshToken,
  async (job: Job<RefreshTokenJobData>) => {
    if (job.data.socialAccountId === "__sweep__") {
      return processRefreshTokenSweep();
    }
    return processRefreshTokenJob(job);
  },
  { connection, concurrency: 3 },
);

const analyticsWorker = new Worker<FetchAnalyticsJobData>(
  QUEUE_NAMES.fetchAnalytics,
  async () => processAnalyticsSweep(),
  { connection, concurrency: 1 },
);

for (const worker of [publishWorker, refreshWorker, analyticsWorker]) {
  worker.on("failed", (job, err) => {
    console.error(`[${worker.name}] job ${job?.id} failed:`, err.message);
  });
}

scheduleRepeatingAnalyticsSweep().catch((err) => console.error("Failed to schedule analytics sweep", err));
scheduleRepeatingTokenRefreshSweep().catch((err) => console.error("Failed to schedule token refresh sweep", err));

console.log("Worker started: publish-post, refresh-token, fetch-analytics");

async function shutdown() {
  await Promise.all([publishWorker.close(), refreshWorker.close(), analyticsWorker.close()]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
