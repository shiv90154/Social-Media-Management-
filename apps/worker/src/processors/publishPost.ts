import type { Job } from "bullmq";
import { prisma } from "@smm/db";
import { connectorRegistry, type PublishMediaInput } from "@smm/connectors";
import { decryptToken, encryptToken } from "@smm/auth";
import type { PublishPostJobData } from "@smm/queue";
import { notify } from "../lib/notifications";
import { recomputePostStatus } from "../lib/rollup";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export async function processPublishPost(job: Job<PublishPostJobData>): Promise<void> {
  const target = await prisma.postTarget.findUnique({
    where: { id: job.data.postTargetId },
    include: { post: { include: { media: { include: { mediaAsset: true }, orderBy: { order: "asc" } } } }, socialAccount: true },
  });

  if (!target) return; // Target/post was deleted since the job was scheduled.
  if (target.status === "CANCELLED") return;

  const { post, socialAccount } = target;
  const connector = connectorRegistry.get(target.platform);

  await prisma.postTarget.update({ where: { id: target.id }, data: { status: "PUBLISHING" } });

  let accessToken = decryptToken(socialAccount.accessToken);
  const expiringSoon =
    socialAccount.tokenExpiresAt && socialAccount.tokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;

  if (expiringSoon) {
    try {
      const refreshed = await connector.refreshToken({
        socialAccountId: socialAccount.id,
        organizationId: socialAccount.organizationId,
        externalUserId: socialAccount.externalUserId,
        accessToken,
        refreshToken: socialAccount.refreshToken ? decryptToken(socialAccount.refreshToken) : null,
        tokenExpiresAt: socialAccount.tokenExpiresAt,
        metadata: socialAccount.metadata as Record<string, unknown> | null,
      });
      accessToken = refreshed.accessToken;
      await prisma.socialAccount.update({
        where: { id: socialAccount.id },
        data: {
          accessToken: encryptToken(refreshed.accessToken),
          refreshToken: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : socialAccount.refreshToken,
          tokenExpiresAt: refreshed.expiresAt ?? socialAccount.tokenExpiresAt,
          status: "ACTIVE",
        },
      });
    } catch (error) {
      await failTarget(target.id, post.organizationId, post.id, "TOKEN_EXPIRED", errorMessage(error));
      await prisma.socialAccount.update({ where: { id: socialAccount.id }, data: { status: "EXPIRED" } });
      return;
    }
  }

  const media: PublishMediaInput[] = post.media.map((pm) => ({
    url: pm.mediaAsset.url,
    type: pm.mediaAsset.type.toLowerCase() as "image" | "video" | "gif",
    mimeType: pm.mediaAsset.mimeType,
    sizeBytes: pm.mediaAsset.sizeBytes,
    width: pm.mediaAsset.width ?? undefined,
    height: pm.mediaAsset.height ?? undefined,
    durationSec: pm.mediaAsset.durationSec ?? undefined,
  }));

  const mediaIssues = connector.validateMedia(media);
  if (mediaIssues.length > 0) {
    await failTarget(target.id, post.organizationId, post.id, mediaIssues[0]!.errorCode, mediaIssues[0]!.message);
    return;
  }

  const result = await connector.publish({
    postTargetId: target.id,
    account: {
      socialAccountId: socialAccount.id,
      organizationId: socialAccount.organizationId,
      externalUserId: socialAccount.externalUserId,
      accessToken,
      refreshToken: socialAccount.refreshToken ? decryptToken(socialAccount.refreshToken) : null,
      tokenExpiresAt: socialAccount.tokenExpiresAt,
      metadata: socialAccount.metadata as Record<string, unknown> | null,
    },
    caption: target.captionOverride || post.baseCaption,
    media,
  });

  if (result.success) {
    await prisma.postTarget.update({
      where: { id: target.id },
      data: {
        status: "PUBLISHED",
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        publishedAt: new Date(),
        error: null,
        errorCode: null,
      },
    });
    await recomputePostStatus(post.id);
    return;
  }

  const attempts = target.attempts + 1;
  if (result.retryable && attempts < MAX_ATTEMPTS) {
    await prisma.postTarget.update({
      where: { id: target.id },
      data: { attempts, status: "QUEUED", error: result.errorMessage, errorCode: result.errorCode },
    });
    // Throwing lets BullMQ apply the queue's exponential backoff and retry.
    throw new Error(result.errorMessage ?? "Publish failed, retrying");
  }

  await failTarget(target.id, post.organizationId, post.id, result.errorCode ?? "UNKNOWN", result.errorMessage ?? "Publish failed", attempts);
}

/** Marks a PostTarget as terminally FAILED (no further BullMQ retries), notifies, and rolls up the parent Post's status. */
async function failTarget(
  targetId: string,
  organizationId: string,
  postId: string,
  errorCode: string,
  errorMessage: string,
  attempts?: number,
) {
  await prisma.postTarget.update({
    where: { id: targetId },
    data: {
      status: "FAILED",
      error: errorMessage,
      errorCode,
      ...(attempts !== undefined ? { attempts } : {}),
    },
  });
  await notify(organizationId, "PUBLISH_FAILURE", "Post failed to publish", errorMessage, postId);
  await recomputePostStatus(postId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
