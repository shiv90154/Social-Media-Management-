import Link from "next/link";
import { prisma } from "@smm/db";
import type { PostStatus } from "@smm/db";
import { Badge, Card, CardContent, PlatformBadge, StatusChip, type PlatformKey } from "@smm/ui";
import { getCurrentContext } from "@/lib/current-org";

const FILTERS: { label: string; value: PostStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Drafts", value: "DRAFT" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Published", value: "PUBLISHED" },
  { label: "Failed", value: "FAILED" },
];

export default async function PostsPage({ searchParams }: { searchParams: { status?: string } }) {
  const ctx = await getCurrentContext();
  const status = searchParams.status as PostStatus | undefined;

  const posts = await prisma.post.findMany({
    where: { organizationId: ctx.organizationId, ...(status ? { status } : {}) },
    include: { targets: true, media: { include: { mediaAsset: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
        <p className="text-sm text-muted-foreground">All drafts, scheduled, published, and failed posts.</p>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value === "ALL" ? "/posts" : `/posts?status=${filter.value}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              (filter.value === "ALL" && !status) || status === filter.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts here yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <Link key={post.id} href={`/posts/${post.id}`}>
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center justify-between gap-4 pt-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{post.baseCaption || "(no caption)"}</p>
                    <p className="text-xs text-muted-foreground">
                      {post.scheduledAt
                        ? `Scheduled for ${new Date(post.scheduledAt).toLocaleString()}`
                        : `Created ${new Date(post.createdAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {post.targets.map((t) => (
                      <PlatformBadge key={t.id} platform={t.platform as PlatformKey} />
                    ))}
                    <StatusChip status={post.status} />
                    {post.targets.some((t) => t.status === "FAILED") && (
                      <Badge variant="destructive">Has failures</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
