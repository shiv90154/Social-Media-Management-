"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@smm/ui";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notifications: NotificationItem[] };
        if (!cancelled) setItems(data.notifications);
      } catch {
        // Polling best-effort; a transient failure just waits for the next tick.
      }
    }
    load();
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const unreadCount = items.filter((i) => !i.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border p-3 text-sm font-semibold">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className={cn("border-b border-border p-3 text-sm last:border-b-0", !item.read && "bg-accent/40")}
              >
                <p className="font-medium">{item.title}</p>
                <p className="text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
