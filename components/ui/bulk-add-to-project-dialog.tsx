"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FolderKanban } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactIds: string[];
  onDone: () => void;
};

/** Bulk variant of AddToProjectDialog — assigns every selected artifact to one chosen project. */
export function BulkAddToProjectDialog({ open, onOpenChange, artifactIds, onDone }: Props) {
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const { data: projects, isLoading } = trpc.project.list.useQuery(undefined, { enabled: open });

  const assign = trpc.project.assignArtifactsBulk.useMutation({
    onSuccess: (result) => {
      onOpenChange(false);
      onDone();
      if (result.skippedIds.length > 0) {
        toast({
          title: `Added ${result.assignedIds.length}, skipped ${result.skippedIds.length}`,
          description: "Skipped items are either not a doc/plan or you can't access them.",
        });
      } else {
        toast({ title: `Added ${result.assignedIds.length} item(s) to the project`, variant: "success" });
      }
    },
    onError: (e) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
    onSettled: () => setPendingProjectId(null),
  });

  const candidates = (projects ?? []).filter((p) => p.canManage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {artifactIds.length} item(s) to a project</DialogTitle>
        </DialogHeader>
        <div className="divide-y rounded-md border max-h-72 overflow-y-auto">
          {isLoading && <p className="px-3 py-4 text-sm text-muted-foreground text-center">Loading…</p>}
          {!isLoading && candidates.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">
              No projects you manage are available. Create one first.
            </p>
          )}
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={assign.isPending}
              onClick={() => {
                setPendingProjectId(p.id);
                assign.mutate({ projectId: p.id, artifactIds });
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                {p.description && <p className="text-xs text-muted-foreground truncate">{p.description}</p>}
              </div>
              {pendingProjectId === p.id && assign.isPending && (
                <span className="text-xs text-muted-foreground shrink-0">Adding…</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
