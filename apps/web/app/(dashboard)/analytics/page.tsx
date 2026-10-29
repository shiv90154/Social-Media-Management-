import { prisma } from "@smm/db";
import { Card, CardContent, PlatformBadge, type PlatformKey } from "@smm/ui";
import { getCurrentContext } from "@/lib/current-org";

export default async function AnalyticsPage() {
  const ctx = await getCurrentContext();

  const targets = await prisma.postTarget.findMany({
    where: { post: { organizationId: ctx.organizationId }, status: "PUBLISHED" },
    include: {
      post: true,
      socialAccount: true,
      analytics: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  const withMetrics = targets.filter((t) => t.analytics.length > 0);
  const allMetricKeys = Array.from(
    new Set(withMetrics.flatMap((t) => Object.keys(t.analytics[0]!.metrics as Record<string, number>))),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Metrics are pulled from each platform&apos;s API where it exposes them for organic posts.
        </p>
      </div>

      {withMetrics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No analytics yet. Metrics appear here a few hours after a post publishes successfully (some platforms,
          like LinkedIn and TikTok, don&apos;t expose organic analytics through their public API).
        </p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Post</th>
                  <th className="pb-2 pr-4">Platform</th>
                  {allMetricKeys.map((key) => (
                    <th key={key} className="pb-2 pr-4 capitalize">
                      {key.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {withMetrics.map((target) => {
                  const metrics = target.analytics[0]!.metrics as Record<string, number>;
                  return (
                    <tr key={target.id} className="border-b border-border last:border-0">
                      <td className="max-w-xs truncate py-2 pr-4">{target.post.baseCaption || "(no caption)"}</td>
                      <td className="py-2 pr-4">
                        <PlatformBadge platform={target.platform as PlatformKey} />
                      </td>
                      {allMetricKeys.map((key) => (
                        <td key={key} className="py-2 pr-4">
                          {metrics[key] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
