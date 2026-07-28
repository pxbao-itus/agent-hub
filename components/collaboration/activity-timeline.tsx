"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { FileClock, History, MessageSquareText } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/relative-time";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ActivityItem = inferRouterOutputs<AppRouter>["comment"]["activity"]["items"][number];

function actorName(item: ActivityItem): string {
  return item.actor?.name ?? (item.actor?.username ? `@${item.actor.username}` : "Someone");
}

function systemDescription(item: Extract<ActivityItem, { source: "system" }>): string {
  const actor = actorName(item);
  const metadata = item.system.metadata ?? {};
  const label = (value: unknown, fallback = "none") =>
    typeof value === "string" && value.length ? value : fallback;

  switch (item.system.action) {
    case "assignment.assigner.change":
      return `${actor} changed the assigner: ${label(metadata.oldAssignerName)} → ${label(metadata.newAssignerName)}`;
    case "assignment.assignee.add":
      return `${actor} added ${label(metadata.userName, "someone")} as an assignee`;
    case "assignment.assignee.remove":
      return `${actor} removed ${label(metadata.userName, "someone")} as an assignee`;
    case "assignment.status.change":
      return `${actor} changed status: ${label(metadata.oldValue)} → ${label(metadata.newValue)}`;
    case "assignment.priority.change":
      return `${actor} changed priority: ${label(metadata.oldValue)} → ${label(metadata.newValue)}`;
    case "assignment.due_date.change":
      return `${actor} changed due date: ${label(metadata.oldValue)} → ${label(metadata.newValue)}`;
    case "project.artifact.add":
      return `${actor} added this item to ${label(metadata.projectName, "a project")}`;
    case "project.artifact.remove":
      return `${actor} removed this item from ${label(metadata.projectName, "a project")}`;
    default:
      return `${actor} updated this item`;
  }
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const icon =
    item.source === "comment" ? MessageSquareText :
      item.source === "version" ? FileClock :
        History;
  const Icon = icon;

  return (
    <div className="flex items-start gap-2.5 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {item.source === "comment" ? (
          <>
            <p className="text-sm font-medium">{actorName(item)} commented</p>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {item.comment.deletedAt ? "This comment was deleted." : item.comment.body}
            </p>
          </>
        ) : item.source === "version" ? (
          <>
            <p className="text-sm">{actorName(item)} created version {item.version.versionNo}</p>
            {item.version.changelog && (
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{item.version.changelog}</p>
            )}
          </>
        ) : (
          <p className="text-sm">{systemDescription(item)}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(item.createdAt)}</p>
      </div>
    </div>
  );
}

export function ActivityTimeline({ artifactId }: { artifactId: string }) {
  const [open, setOpen] = useState(false);
  const compact = trpc.comment.activity.useQuery({ artifactId, limit: 5 });
  const all = trpc.comment.activity.useInfiniteQuery(
    { artifactId, limit: 20 },
    {
      enabled: open,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );

  if (compact.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (compact.error) return <p className="text-sm text-destructive">Could not load activity.</p>;
  if (!compact.data?.items.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;

  const allItems = all.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div>
      <div className="divide-y">
        {compact.data.items.map((item) => <ActivityRow key={item.id} item={item} />)}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="mt-2 w-full">View all activity</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
            <DialogDescription>Comments, versions, assignments, and project changes in one timeline.</DialogDescription>
          </DialogHeader>
          {all.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : all.error ? (
            <p className="py-6 text-center text-sm text-destructive">Could not load activity.</p>
          ) : (
            <>
              <div className="divide-y">
                {allItems.map((item) => <ActivityRow key={item.id} item={item} />)}
              </div>
              {all.hasNextPage && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={all.isFetchingNextPage}
                  onClick={() => all.fetchNextPage()}
                >
                  {all.isFetchingNextPage ? "Loading…" : "Load earlier activity"}
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
