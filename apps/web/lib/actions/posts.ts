"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@smm/db";
import { connectorRegistry } from "@smm/connectors";
import { enqueuePublishJob, cancelPublishJob } from "@smm/queue";
import { getCurrentContext } from "@/lib/current-org";

export interface ComposerTarget {
  socialAccountId: string;
  captionOverride?: string;
}

export interface SavePostInput {
  postId?: string;
  baseCaption: string;
  mediaAssetIds: string[];
  targets: ComposerTarget[];
  mode: "draft" | "now" | "schedule";
  scheduledAt?: string; // ISO string, required when mode === "schedule"
}

async function assertMediaCompatibility(
  organizationId: string,
  mediaAssetIds: string[],
  targets: ComposerTarget[],
) {
  if (mediaAssetIds.length === 0) return [];
  const media = await prisma.mediaAsset.findMany({ where: { id: { in: mediaAssetIds }, organizationId } });
  const publishMedia = media.map((m) => ({
    url: m.url,
    type: m.type.toLowerCase() as "image" | "video" | "gif",
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    durationSec: m.durationSec ?? undefined,
  }));

  const issues: { socialAccountId: string; messages: string[] }[] = [];
  for (const target of targets) {
    const account = await prisma.socialAccount.findUnique({ where: { id: target.socialAccountId } });
    if (!account) continue;
    const connector = connectorRegistry.get(account.platform);
    const validation = connector.validateMedia(publishMedia);
    if (validation.length > 0) {
      issues.push({ socialAccountId: target.socialAccountId, messages: validation.map((v) => v.message) });
    }
  }
  return issues;
}

export async function savePostAction(input: SavePostInput): Promise<{ error?: string; postId?: string }> {
  const ctx = await getCurrentContext();

  if (input.targets.length === 0 && input.mode !== "draft") {
    return { error: "Select at least one social account to publish to." };
  }

  if (input.mode === "schedule" || input.mode === "now") {
    const issues = await assertMediaCompatibility(ctx.organizationId, input.mediaAssetIds, input.targets);
    if (issues.length > 0) {
      return { error: issues.flatMap((i) => i.messages).join(" ") };
    }
  }

  const scheduledAt =
    input.mode === "schedule" && input.scheduledAt
      ? new Date(input.scheduledAt)
      : input.mode === "now"
        ? new Date()
        : null;

  const status = input.mode === "draft" ? "DRAFT" : "SCHEDULED";

  const post = await prisma.$transaction(async (tx) => {
    const created = input.postId
      ? await tx.post.update({
          where: { id: input.postId, organizationId: ctx.organizationId },
          data: { baseCaption: input.baseCaption, status, scheduledAt },
        })
      : await tx.post.create({
          data: {
            organizationId: ctx.organizationId,
            createdBy: ctx.userId,
            baseCaption: input.baseCaption,
            status,
            scheduledAt,
          },
        });

    await tx.postMedia.deleteMany({ where: { postId: created.id } });
    if (input.mediaAssetIds.length > 0) {
      await tx.postMedia.createMany({
        data: input.mediaAssetIds.map((mediaAssetId, order) => ({ postId: created.id, mediaAssetId, order })),
      });
    }

    await tx.postTarget.deleteMany({ where: { postId: created.id } });
    if (input.targets.length > 0) {
      const accounts = await tx.socialAccount.findMany({
        where: { id: { in: input.targets.map((t) => t.socialAccountId) }, organizationId: ctx.organizationId },
      });
      const accountById = new Map(accounts.map((a) => [a.id, a]));
      for (const target of input.targets) {
        const account = accountById.get(target.socialAccountId);
        if (!account) continue;
        await tx.postTarget.create({
          data: {
            postId: created.id,
            socialAccountId: account.id,
            platform: account.platform,
            captionOverride: target.captionOverride || null,
            status: status === "DRAFT" ? "PENDING" : "QUEUED",
          },
        });
      }
    }

    return created;
  });

  if (status === "SCHEDULED" && scheduledAt) {
    const targets = await prisma.postTarget.findMany({ where: { postId: post.id } });
    for (const target of targets) {
      const bullJobId = await enqueuePublishJob(target.id, scheduledAt);
      await prisma.postTarget.update({ where: { id: target.id }, data: { bullJobId } });
    }
  }

  revalidatePath("/posts");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { postId: post.id };
}

export async function cancelScheduledPostAction(postId: string) {
  const ctx = await getCurrentContext();
  const targets = await prisma.postTarget.findMany({
    where: { postId, post: { organizationId: ctx.organizationId } },
  });
  for (const target of targets) {
    if (target.bullJobId) {
      await cancelPublishJob(target.bullJobId);
    }
  }
  await prisma.postTarget.updateMany({ where: { postId }, data: { status: "CANCELLED" } });
  await prisma.post.update({ where: { id: postId }, data: { status: "CANCELLED" } });
  revalidatePath("/posts");
  revalidatePath("/calendar");
}

export async function reschedulePostAction(postId: string, newScheduledAt: string) {
  const ctx = await getCurrentContext();
  const post = await prisma.post.findFirst({ where: { id: postId, organizationId: ctx.organizationId } });
  if (!post) return;

  const newDate = new Date(newScheduledAt);
  const targets = await prisma.postTarget.findMany({ where: { postId } });
  for (const target of targets) {
    if (target.bullJobId) {
      await cancelPublishJob(target.bullJobId);
    }
    const bullJobId = await enqueuePublishJob(target.id, newDate);
    await prisma.postTarget.update({ where: { id: target.id }, data: { bullJobId, status: "QUEUED" } });
  }
  await prisma.post.update({ where: { id: postId }, data: { scheduledAt: newDate, status: "SCHEDULED" } });
  revalidatePath("/posts");
  revalidatePath("/calendar");
}

export async function deletePostAction(postId: string) {
  const ctx = await getCurrentContext();
  await prisma.post.delete({ where: { id: postId, organizationId: ctx.organizationId } });
  revalidatePath("/posts");
  redirect("/posts");
}
