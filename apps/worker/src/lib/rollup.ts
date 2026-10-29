import { prisma } from "@smm/db";
import { notify } from "./notifications";

/**
 * Recomputes a Post's overall status from its PostTargets once they've all
 * settled: all published -> PUBLISHED, all failed -> FAILED, a mix ->
 * PARTIALLY_FAILED. Called after every target finishes publishing.
 */
export async function recomputePostStatus(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { targets: true } });
  if (!post) return;

  const targets = post.targets;
  const unsettled = targets.some((t) => t.status === "PENDING" || t.status === "QUEUED" || t.status === "PUBLISHING");
  if (unsettled) return;

  const allPublished = targets.every((t) => t.status === "PUBLISHED");
  const allFailed = targets.every((t) => t.status === "FAILED" || t.status === "SKIPPED_UNSUPPORTED");
  const anyPublished = targets.some((t) => t.status === "PUBLISHED");

  const status = allPublished ? "PUBLISHED" : allFailed ? "FAILED" : anyPublished ? "PARTIALLY_FAILED" : post.status;

  await prisma.post.update({
    where: { id: postId },
    data: { status, publishedAt: allPublished || anyPublished ? new Date() : post.publishedAt },
  });

  if (status === "PUBLISHED") {
    await notify(post.organizationId, "PUBLISH_SUCCESS", "Post published", "Your post published successfully everywhere.", postId);
  } else if (status === "FAILED") {
    await notify(post.organizationId, "PUBLISH_FAILURE", "Post failed", "Your post failed to publish to every selected platform.", postId);
  } else if (status === "PARTIALLY_FAILED") {
    await notify(
      post.organizationId,
      "PUBLISH_PARTIAL",
      "Post partially published",
      "Your post published to some platforms but failed on others. Check the post for details.",
      postId,
    );
  }
}
