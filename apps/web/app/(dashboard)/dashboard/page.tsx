import Link from "next/link";
import { prisma } from "@smm/db";
import { Button, Card, CardContent, CardHeader, CardTitle, PlatformBadge, StatusChip, type PlatformKey } from "@smm/ui";
import { getCurrentContext } from "@/lib/current-org";

export default async function DashboardPage() {
  const ctx = await getCurrentContext();

  const [statusCounts, upcoming, accounts, recentNotifications] = await Promise.all([
    prisma.post.groupBy({
      by: ["status"],
      where: { organizationId: ctx.organizationId },
      _count: { _all: true },
    }),
    prisma.post.findMany({
      where: { organizationId: ctx.organizationId, status: "SCHEDULED" },
      include: { targets: true },
      orderBy: { scheduledAt: "asc" },
      take: 5,
    }),
    prisma.socialAccount.findMany({ where: { organizationId: ctx.organizationId } }),
    prisma.notification.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const countFor = (status: string) => statusCounts.find((s) => s.status === status)?._count._all ?? 0;
  const attentionAccounts = accounts.filter((a) => a.status !== "ACTIVE");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s happening across your accounts.</p>
        </div>
        <Link href="/create">
          <Button>New post</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Scheduled", value: countFor("SCHEDULED") },
          { label: "Published", value: countFor("PUBLISHED") },
          { label: "Drafts", value: countFor("DRAFT") },
          { label: "Failed", value: countFor("FAILED") + countFor("PARTIALLY_FAILED") },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-5">
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming posts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>}
            {upcoming.map((post) => (
              <Link key={post.id} href={`/posts/${post.id}`} className="flex items-center justify-between rounded-md p-2 hover:bg-muted">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{post.baseCaption || "(no caption)"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(post.scheduledAt!).toLocaleString()}</p>
                </div>
                <div className="flex gap-1">
                  {post.targets.slice(0, 3).map((t) => (
                    <PlatformBadge key={t.id} platform={t.platform as PlatformKey} />
                  ))}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connection health</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No accounts connected yet.{" "}
                <Link href="/accounts" className="text-primary hover:underline">
                  Connect one
                </Link>
                .
              </p>
            )}
            {attentionAccounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between">
                <span className="text-sm">{account.displayName}</span>
                <StatusChip status={account.status} />
              </div>
            ))}
            {accounts.length > 0 && attentionAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">All connected accounts are healthy.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {recentNotifications.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {recentNotifications.map((n) => (
            <div key={n.id} className="flex items-center justify-between text-sm">
              <span>{n.title}</span>
              <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
