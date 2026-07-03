"use client";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FolderKanban, Plus } from "lucide-react";

type Props = {
  artifactId: string;
  assignedProjectIds: Set<string>;
  onAssigned: () => void;
};

/** Picker of projects the caller manages, to add this doc/plan to. */
export function AddToProjectDialog({ artifactId, assignedProjectIds, onAssigned }: Props) {
  const { data: projects, isLoading } = trpc.project.list.useQuery();

  const assign = trpc.project.assignArtifact.useMutation({
    onSuccess: () => {
      onAssigned();
      toast({ title: "Added to project", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const candidates = (projects ?? []).filter((p) => p.canManage && !assignedProjectIds.has(p.id));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add to project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to a project</DialogTitle>
        </DialogHeader>
        <div className="divide-y rounded-md border max-h-72 overflow-y-auto">
          {isLoading && (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">Loading…</p>
          )}
          {!isLoading && candidates.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">
              No projects you manage are available. Create one first, or ask its manager to add this.
            </p>
          )}
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={assign.isPending}
              onClick={() => assign.mutate({ projectId: p.id, artifactId })}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                {p.description && (
                  <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
