import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { listUserResponsibilities } from "@/server/services/user-responsibility";

type Data = Awaited<ReturnType<typeof listUserResponsibilities>>;

export function Responsibilities({ data }: { data: Data }) {
  const empty = data.assignments.length === 0 && data.workflowStages.length === 0;
  if (empty) {
    return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No visible current responsibilities.</p>;
  }
  return (
    <div className="space-y-4">
      {data.assignments.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Docs and plans</h3>
          <div className="divide-y rounded-md border">
            {data.assignments.map((item) => (
              <Link key={item.id} href={item.href} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/30">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="text-xs capitalize text-muted-foreground">{item.kind} · {item.role}</span>
                </span>
                <div className="flex shrink-0 gap-1">
                  <Badge variant="outline">{item.status}</Badge>
                  {item.priority !== "normal" && <Badge variant="secondary">{item.priority}</Badge>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {data.workflowStages.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Workflow stages</h3>
          <div className="divide-y rounded-md border">
            {data.workflowStages.map((item) => (
              <Link key={item.stageId} href={item.href} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/30">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.stageName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.workflowName}</span>
                </span>
                <Badge variant="outline">{item.status}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
      {data.truncated && <p className="text-xs text-muted-foreground">Showing the first 20 visible responsibilities.</p>}
    </div>
  );
}
