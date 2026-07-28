"use client";

import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/relative-time";
import type { UserActivityFilter } from "@/server/services/user-activity";

type Item = inferRouterOutputs<AppRouter>["user"]["listActivity"]["items"][number];
const FILTERS: Array<{ value: UserActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "content", label: "Content" },
  { value: "collaboration", label: "Collaboration" },
  { value: "workflow", label: "Workflow" },
  { value: "organization", label: "Organization" },
];

function description(item: Item) {
  const v = item.presentation.values;
  switch (item.presentation.key) {
    case "content.version_created":
      return `Created version ${v.versionNo ?? ""}`.trim();
    case "comment.created":
      return "Added a comment";
    case "comment.deleted":
      return "Commented (comment deleted)";
    case "comment.mentioned":
      return "Was mentioned in a comment";
    case "assignment.assignee.add":
      return item.direction === "affected" ? "Was assigned" : `Assigned ${v.userName ?? "a user"}`;
    case "assignment.assignee.remove":
      return item.direction === "affected" ? "Was unassigned" : `Unassigned ${v.userName ?? "a user"}`;
    case "assignment.assigner.change":
      return item.direction === "affected" ? "Assigner responsibility changed" : "Changed the assigner";
    case "membership.add":
      return "Was added to a group";
    case "membership.remove":
      return "Was removed from a group";
    case "membership.role":
      return `Membership role changed to ${v.role ?? "a new role"}`;
    case "user.role":
      return `System role changed to ${v.role ?? "a new role"}`;
    default:
      return item.presentation.key.startsWith("workflow.")
        ? item.presentation.key.replaceAll(".", " ")
        : "Updated this item";
  }
}

export function UserActivity({ userId, isSuperAdmin }: { userId: string; isSuperAdmin: boolean }) {
  const [filter, setFilter] = useState<UserActivityFilter>("all");
  const query = trpc.user.listActivity.useInfiniteQuery(
    { userId, filter, limit: 20 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
        {[...FILTERS, ...(isSuperAdmin ? [{ value: "administration" as const, label: "Administration" }] : [])].map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={filter === option.value ? "default" : "outline"}
            className="h-8 whitespace-nowrap"
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {query.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading activity…</p>
      ) : query.error ? (
        <div className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
          Could not load activity.
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No visible activity yet.</p>
      ) : (
        <>
          <div className="divide-y rounded-md border">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm">{description(item)}</p>
                  {item.target && (
                    item.target.href ? (
                      <Link href={item.target.href} className="mt-0.5 block truncate text-sm font-medium hover:underline">
                        {item.target.label}
                      </Link>
                    ) : (
                      <p className="mt-0.5 truncate text-sm font-medium">{item.target.label}</p>
                    )
                  )}
                  <p className="mt-1 text-xs text-muted-foreground" title={item.createdAt.toISOString()}>
                    {formatRelativeTime(item.createdAt)}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">{item.direction}</Badge>
              </div>
            ))}
          </div>
          {query.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load earlier activity"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
