"use client";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/relative-time";

const LABELS: Record<string, string> = {
  "workflow.created": "created the workflow",
  "workflow.updated": "updated workflow details",
  "stage.added": "added a stage",
  "stage.removed": "removed a stage",
  "stage.reordered": "reordered the stages",
  "stage.details.changed": "updated a stage",
  "stage.status.changed": "changed a stage status",
  "artifact.attached": "attached an artifact",
  "artifact.detached": "detached an artifact",
};

export function WorkflowActivity({ workflowId }: { workflowId: string }) {
  const activity = trpc.workflow.activity.useInfiniteQuery(
    { workflowId, limit: 10 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  );
  const events = activity.data?.pages.flatMap((page) => page.items) ?? [];

  if (activity.isLoading) {
    return <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  }
  if (activity.error) {
    return <p className="text-sm text-destructive">Could not load activity.</p>;
  }
  if (!events.length) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {events.map((event) => {
          const metadata = event.metadata as Record<string, unknown> | null;
          const stageName = typeof metadata?.stageName === "string" ? metadata.stageName : null;
          return (
            <li key={event.id} className="border-l-2 pl-3 text-sm">
              <p>
                <span className="font-medium">{event.actor?.name ?? event.actor?.username ?? "Deleted user"}</span>{" "}
                <span className="text-muted-foreground">{LABELS[event.type] ?? event.type}</span>
                {stageName && <> “{stageName}”</>}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatRelativeTime(event.createdAt)} · {event.source.toUpperCase()}
              </p>
            </li>
          );
        })}
      </ol>
      {activity.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => activity.fetchNextPage()}
          disabled={activity.isFetchingNextPage}
        >
          Load older activity
        </Button>
      )}
    </div>
  );
}
