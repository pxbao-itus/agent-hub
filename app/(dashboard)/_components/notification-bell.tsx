"use client";

import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/relative-time";
import { artifactDetailPath } from "@/lib/artifact-routes";

type NotificationRow = {
  type: string;
  metadata: unknown;
  actor: { name: string | null; email: string | null } | null;
  artifact: { title: string };
};

function describeNotification(n: NotificationRow): string {
  const actor = n.actor?.name ?? n.actor?.email ?? "Someone";
  if (n.type === "assignment") {
    const m = (n.metadata ?? {}) as Record<string, unknown>;
    if (m.event === "assigner.change") {
      const to = (m.newAssignerName as string | null) ?? "no one";
      return `${actor} made ${to} the assigner of "${n.artifact.title}"`;
    }
    if (m.event === "assignee.add") {
      return `${actor} added ${(m.userName as string | null) ?? "someone"} as an assignee on "${n.artifact.title}"`;
    }
    if (m.event === "assignee.remove") {
      return `${actor} removed ${(m.userName as string | null) ?? "someone"} as an assignee on "${n.artifact.title}"`;
    }
  }
  return `${actor} updated ${n.artifact.title}`;
}

export function NotificationBell() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const unread = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const list = trpc.notification.list.useQuery({ limit: 10 });

  const markAsRead = trpc.notification.markAsRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
    },
  });
  const markAllAsRead = trpc.notification.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
    },
  });

  const count = unread.data?.count ?? 0;
  const items = list.data ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px] leading-none"
            >
              {count > 9 ? "9+" : count}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground"
              onClick={() => markAllAsRead.mutate()}
            >
              Mark all as read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (!n.isRead) markAsRead.mutate({ id: n.id });
                router.push(artifactDetailPath(n.artifact.kind, n.artifact.id));
              }}
              className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
            >
              <span className={n.isRead ? "text-muted-foreground" : "font-medium"}>
                {describeNotification(n)}
              </span>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(n.createdAt)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
