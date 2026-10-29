import { prisma } from "@smm/db";
import { getCurrentContext } from "@/lib/current-org";
import { CalendarView } from "@/components/calendar-view";

export default async function CalendarPage({ searchParams }: { searchParams: { year?: string; month?: string } }) {
  const ctx = await getCurrentContext();
  const now = new Date();
  const year = searchParams.year ? Number(searchParams.year) : now.getFullYear();
  const month = searchParams.month ? Number(searchParams.month) : now.getMonth();

  const rangeStart = new Date(year, month, 1);
  const rangeEnd = new Date(year, month + 1, 1);

  const posts = await prisma.post.findMany({
    where: {
      organizationId: ctx.organizationId,
      scheduledAt: { gte: rangeStart, lt: rangeEnd },
      status: { in: ["SCHEDULED", "PUBLISHED", "FAILED", "PARTIALLY_FAILED"] },
    },
    include: { targets: true },
    orderBy: { scheduledAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">Everything scheduled to publish this month.</p>
      </div>
      <CalendarView
        year={year}
        month={month}
        posts={posts.map((p) => ({
          id: p.id,
          baseCaption: p.baseCaption,
          scheduledAt: p.scheduledAt!.toISOString(),
          status: p.status,
          platforms: p.targets.map((t) => t.platform),
        }))}
      />
    </div>
  );
}
