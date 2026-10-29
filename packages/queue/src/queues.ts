import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const QUEUE_NAMES = {
  publishPost: "publish-post",
  refreshToken: "refresh-token",
  fetchAnalytics: "fetch-analytics",
} as const;

export interface PublishPostJobData {
  postTargetId: string;
}

export interface RefreshTokenJobData {
  socialAccountId: string;
}

export interface FetchAnalyticsJobData {
  postTargetId: string;
}

let publishPostQueue: Queue<PublishPostJobData> | undefined;
let refreshTokenQueue: Queue<RefreshTokenJobData> | undefined;
let fetchAnalyticsQueue: Queue<FetchAnalyticsJobData> | undefined;

export function getPublishPostQueue(): Queue<PublishPostJobData> {
  publishPostQueue ??= new Queue<PublishPostJobData>(QUEUE_NAMES.publishPost, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7 },
      removeOnFail: { age: 60 * 60 * 24 * 30 },
    },
  });
  return publishPostQueue;
}

export function getRefreshTokenQueue(): Queue<RefreshTokenJobData> {
  refreshTokenQueue ??= new Queue<RefreshTokenJobData>(QUEUE_NAMES.refreshToken, {
    connection: getRedisConnection(),
    defaultJobOptions: { attempts: 2 },
  });
  return refreshTokenQueue;
}

export function getFetchAnalyticsQueue(): Queue<FetchAnalyticsJobData> {
  fetchAnalyticsQueue ??= new Queue<FetchAnalyticsJobData>(QUEUE_NAMES.fetchAnalytics, {
    connection: getRedisConnection(),
    defaultJobOptions: { attempts: 2 },
  });
  return fetchAnalyticsQueue;
}

/** Schedules (or immediately queues, when delayMs<=0) a publish job for one PostTarget. */
export async function enqueuePublishJob(postTargetId: string, runAt: Date): Promise<string> {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  const job = await getPublishPostQueue().add(
    "publish",
    { postTargetId },
    { delay, jobId: `publish-${postTargetId}-${Date.now()}` },
  );
  return job.id!;
}

/** Cancels a previously-enqueued publish job (used on reschedule/cancel). */
export async function cancelPublishJob(bullJobId: string): Promise<void> {
  const job = await getPublishPostQueue().getJob(bullJobId);
  if (job) {
    const state = await job.getState();
    if (state === "waiting" || state === "delayed") {
      await job.remove();
    }
  }
}

export function scheduleRepeatingAnalyticsSweep(): Promise<unknown> {
  return getFetchAnalyticsQueue().add(
    "sweep",
    { postTargetId: "__sweep__" },
    { repeat: { every: 6 * 60 * 60 * 1000 }, jobId: "analytics-sweep" },
  );
}

export function scheduleRepeatingTokenRefreshSweep(): Promise<unknown> {
  return getRefreshTokenQueue().add(
    "sweep",
    { socialAccountId: "__sweep__" },
    { repeat: { every: 60 * 60 * 1000 }, jobId: "token-refresh-sweep" },
  );
}
