"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { toast } from "@/hooks/use-toast";
import { AddToProjectDialog } from "./add-to-project-dialog";
import { FolderKanban, Trash2 } from "lucide-react";

type ProjectRow = { id: string; name: string; description: string | null; canManage: boolean };

type Props = {
  artifactId: string;
  initialProjects: ProjectRow[];
};

/** "Projects" section on a doc/plan detail page — organizational only, mirrors LinkedDocsSection's UI. */
export function ArtifactProjectsSection({ artifactId, initialProjects }: Props) {
  const utils = trpc.useUtils();
  const { data } = trpc.project.listForArtifact.useQuery(
    { artifactId },
    { initialData: initialProjects as never, refetchOnMount: false },
  );
  const rows = data ?? initialProjects;

  const unassign = trpc.project.unassignArtifact.useMutation({
    onSuccess: () => {
      utils.project.listForArtifact.invalidate({ artifactId });
      toast({ title: "Removed from project", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
  });

  if (rows.length === 0) {
    return (
      <AddToProjectDialog
        artifactId={artifactId}
        assignedProjectIds={new Set()}
        onAssigned={() => utils.project.listForArtifact.invalidate({ artifactId })}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="divide-y rounded-md border">
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors">
            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Link href={`/projects/${p.id}`} className="flex-1 min-w-0 group">
              <p className="text-sm font-medium truncate group-hover:underline">{p.name}</p>
              {p.description && (
                <p className="text-xs text-muted-foreground truncate">{p.description}</p>
              )}
            </Link>
            {p.canManage && (
              <button
                type="button"
                onClick={() => unassign.mutate({ projectId: p.id, artifactId })}
                disabled={unassign.isPending}
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Remove from project"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <AddToProjectDialog
        artifactId={artifactId}
        assignedProjectIds={new Set(rows.map((p) => p.id))}
        onAssigned={() => utils.project.listForArtifact.invalidate({ artifactId })}
      />
    </div>
  );
}
