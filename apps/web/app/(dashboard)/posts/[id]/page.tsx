import { notFound } from "next/navigation";
import Image from "next/image";
import { prisma } from "@smm/db";
import { PUBLISH_ERROR_MESSAGES, type PublishErrorCode } from "@smm/connectors";
import { Card, CardContent, PlatformBadge, StatusChip, type PlatformKey } from "@smm/ui";
import { getCurrentContext } from "@/lib/current-org";
import { PostDetailActions } from "@/components/post-detail-actions";

export default async function PostDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentContext();
  const post = await prisma.post.findFirst({
    where: { id: params.id, organizationId: ctx.organizationId },
    include: {
      targets: { include: { socialAccount: true } },
      media: { include: { mediaAsset: true }, orderBy: { order: "asc" } },
    },
  });
  if (!post) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <StatusChip status={post.status} />
            {post.scheduledAt && (
              <span className="text-sm text-muted-foreground">
                {new Date(post.scheduledAt).toLocaleString()}
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-base">{post.baseCaption}</p>
        </div>
        <PostDetailActions postId={post.id} canReschedule={post.status === "SCHEDULED"} />
      </div>

      {post.media.length > 0 && (
        <div className="flex gap-3">
          {post.media.map((pm) => (
            <div key={pm.id} className="relative h-32 w-32 overflow-hidden rounded-md bg-muted">
              {pm.mediaAsset.type === "VIDEO" ? (
                <video src={pm.mediaAsset.url} className="h-full w-full object-cover" muted />
              ) : (
                <Image src={pm.mediaAsset.url} alt="" fill className="object-cover" unoptimized />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Per-platform status</h2>
        {post.targets.map((target) => (
          <Card key={target.id}>
            <CardContent className="flex items-start justify-between gap-4 pt-5">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <PlatformBadge platform={target.platform as PlatformKey} />
                  <span className="text-sm text-muted-foreground">{target.socialAccount.displayName}</span>
                </div>
                {target.captionOverride && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    Custom caption: {target.captionOverride}
                  </p>
                )}
                {target.error && (
                  <p className="mt-1 text-sm text-destructive">
                    {target.errorCode ? PUBLISH_ERROR_MESSAGES[target.errorCode as PublishErrorCode] : target.error}
                  </p>
                )}
                {target.externalUrl && (
                  <a
                    href={target.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-sm text-primary hover:underline"
                  >
                    View live post
                  </a>
                )}
              </div>
              <StatusChip status={target.status} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
