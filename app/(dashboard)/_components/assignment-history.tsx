"use client";

import { trpc } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/relative-time";
import { History } from "lucide-react";
import { UserIdentityLink } from "@/components/ui/user-identity-link";

type Props = {
  artifactId: string;
};

type HistoryRow = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string | Date;
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  actorEmail: string | null;
  actorImage: string | null;
};

function describeAction(row: HistoryRow): string {
  const m = (row.metadata ?? {}) as Record<string, unknown>;

  if (row.action === "assignment.assigner.change") {
    const from = (m.oldAssignerName as string | null) ?? "no one";
    const to = (m.newAssignerName as string | null) ?? "no one";
    return `changed the assigner: ${from} → ${to}`;
  }
  if (row.action === "assignment.assignee.add") {
    return `added ${(m.userName as string | null) ?? "someone"} as an assignee`;
  }
  if (row.action === "assignment.assignee.remove") {
    return `removed ${(m.userName as string | null) ?? "someone"} as an assignee`;
  }
  if (row.action === "assignment.status.change") {
    return `changed status: ${String(m.oldValue)} → ${String(m.newValue)}`;
  }
  if (row.action === "assignment.priority.change") {
    return `changed priority: ${String(m.oldValue)} → ${String(m.newValue)}`;
  }
  if (row.action === "assignment.due_date.change") {
    return `changed due date: ${String(m.oldValue ?? "none")} → ${String(m.newValue ?? "none")}`;
  }
  return row.action;
}

/** Read-only timeline of assigner/assignee changes for a doc/plan. */
export function AssignmentHistory({ artifactId }: Props) {
  const { data, isLoading } = trpc.assignment.history.useQuery({ artifactId });
  const rows = data ?? [];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No assignment changes yet.</p>;
  }

  return (
    <div className="divide-y rounded-md border">
      {rows.map((row) => (
        <div key={row.id} className="flex items-start gap-2.5 px-3 py-2.5">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1 text-sm">
              <UserIdentityLink
                userId={row.actorId}
                name={row.actorName}
                username={row.actorUsername}
                email={row.actorEmail}
                image={row.actorImage}
                compact
              />
              <span>{describeAction(row)}</span>
            </div>
            <p className="text-xs text-muted-foreground">{formatRelativeTime(row.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
