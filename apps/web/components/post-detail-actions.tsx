"use client";

import { useState, useTransition } from "react";
import { Button } from "@smm/ui";
import { cancelScheduledPostAction, deletePostAction, reschedulePostAction } from "@/lib/actions/posts";

export function PostDetailActions({ postId, canReschedule }: { postId: string; canReschedule: boolean }) {
  const [pending, startTransition] = useTransition();
  const [newDate, setNewDate] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canReschedule && (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!newDate || pending}
            onClick={() => startTransition(() => reschedulePostAction(postId, newDate))}
          >
            Reschedule
          </Button>
        </div>
      )}
      {canReschedule && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => cancelScheduledPostAction(postId))}
        >
          Cancel
        </Button>
      )}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => deletePostAction(postId))}
      >
        Delete
      </Button>
    </div>
  );
}
