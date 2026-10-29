"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PlatformIcon, cn, type PlatformKey } from "@smm/ui";

interface CalendarPost {
  id: string;
  baseCaption: string;
  scheduledAt: string;
  status: string;
  platforms: string[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView({ year, month, posts }: { year: number; month: number; posts: CalendarPost[] }) {
  const router = useRouter();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstDay.getDay();

  const postsByDay = new Map<number, CalendarPost[]>();
  for (const post of posts) {
    const day = new Date(post.scheduledAt).getDate();
    postsByDay.set(day, [...(postsByDay.get(day) ?? []), post]);
  }

  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  function navigate(delta: number) {
    const date = new Date(year, month + delta, 1);
    router.push(`/calendar?year=${date.getFullYear()}&month=${date.getMonth()}`);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {firstDay.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </h2>
        <div className="flex gap-1">
          <button onClick={() => navigate(-1)} className="rounded-md p-2 hover:bg-muted" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => navigate(1)} className="rounded-md p-2 hover:bg-muted" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm">
        {WEEKDAYS.map((day) => (
          <div key={day} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">
            {day}
          </div>
        ))}
        {cells.map((day, idx) => (
          <div key={idx} className={cn("min-h-28 bg-card p-2", day === null && "bg-muted/40")}>
            {day !== null && (
              <>
                <p className="mb-1 text-xs text-muted-foreground">{day}</p>
                <div className="flex flex-col gap-1">
                  {(postsByDay.get(day) ?? []).map((post) => (
                    <Link
                      key={post.id}
                      href={`/posts/${post.id}`}
                      className="block rounded bg-primary/10 px-1.5 py-1 text-xs text-primary hover:bg-primary/20"
                    >
                      <div className="flex items-center gap-1">
                        {post.platforms.slice(0, 3).map((p, i) => (
                          <PlatformIcon key={i} platform={p as PlatformKey} className="h-3 w-3" />
                        ))}
                      </div>
                      <p className="truncate">{post.baseCaption || "(no caption)"}</p>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
