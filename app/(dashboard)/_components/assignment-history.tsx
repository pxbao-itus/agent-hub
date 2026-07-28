"use client";

import { trpc } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/relative-time";
import { History } from "lucide-react";

type Props = {
  artifactId: string;
};

type HistoryRow = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string | Date;
  actorName: string | null;
  actorEmail: string | null;
};

function describe(row: HistoryRow): string {
  const actor = row.actorName ?? row.actorEmail ?? "Someone";
  const m = (row.metadata ?? {}) as Record<string, unknown>;

  if (row.action === "assignment.assigner.change") {
    const from = (m.oldAssignerName as string | null) ?? "no one";
    const to = (m.newAssignerName as string | null) ?? "no one";
    return `${actor} changed the assigner: ${from} → ${to}`;
  }
  if (row.action === "assignment.assignee.add") {
    return `${actor} added ${(m.userName as string | null) ?? "someone"} as an assignee`;
  }
  if (row.action === "assignment.assignee.remove") {
    return `${actor} removed ${(m.userName as string | null) ?? "someone"} as an assignee`;
  }
  if (row.action === "assignment.status.change") {
    return `${actor} changed status: ${String(m.oldValue)} → ${String(m.newValue)}`;
  }
  if (row.action === "assignment.priority.change") {
    return `${actor} changed priority: ${String(m.oldValue)} → ${String(m.newValue)}`;
  }
  if (row.action === "assignment.due_date.change") {
    return `${actor} changed due date: ${String(m.oldValue ?? "none")} → ${String(m.newValue ?? "none")}`;
  }
  return `${actor} — ${row.action}`;
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
            <p className="text-sm">{describe(row)}</p>
            <p className="text-xs text-muted-foreground">{formatRelativeTime(row.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
