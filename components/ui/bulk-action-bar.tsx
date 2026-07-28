"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { useListSelection } from "@/components/ui/list-selection-context";
import { BulkAddTagDialog } from "@/components/ui/bulk-add-tag-dialog";
import { BulkAddToProjectDialog } from "@/components/ui/bulk-add-to-project-dialog";
import { BulkAddAssigneeDialog } from "@/components/ui/bulk-add-assignee-dialog";
import { runUndoable } from "@/lib/undoable-action";
import { toast } from "@/hooks/use-toast";
import { Tag, FolderKanban, Trash2, UserPlus, X } from "lucide-react";

type Props = { kind: "prompt" | "skill" | "plan" | "doc" };

/**
 * Floating bulk-action bar (Phase 45 B2). Renders nothing with an empty
 * selection. Delete uses the delayed-execute/Undo pattern (B1) — items are
 * marked "pending" (dimmed, non-interactive) immediately, the real
 * bulkDelete call only fires once the grace window elapses uncancelled.
 */
export function BulkActionBar({ kind }: Props) {
  const router = useRouter();
  const { selected, clear, markPendingDelete, unmarkPendingDelete } = useListSelection();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [assigneeDialogOpen, setAssigneeDialogOpen] = useState(false);

  const bulkDelete = trpc.artifact.bulkDelete.useMutation();

  if (selected.size === 0) return null;

  const ids = [...selected];
  const canAssignToProject = kind === "doc" || kind === "plan";

  function handleDelete() {
    clear();
    markPendingDelete(ids);
    runUndoable({
      key: `bulk-delete-${ids.join(",")}`,
      message: `Deleted ${ids.length} item(s)`,
      onCancel: () => unmarkPendingDelete(ids),
      commit: async () => {
        try {
          const result = await bulkDelete.mutateAsync({ ids });
          if (result.skippedIds.length > 0) {
            toast({
              title: `${result.skippedIds.length} item(s) couldn't be deleted`,
              description: "You may not have permission to edit them.",
              variant: "destructive",
            });
          }
        } finally {
          unmarkPendingDelete(ids);
          router.refresh();
        }
      },
    });
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg">
        <span className="px-1 text-sm font-medium">{selected.size} selected</span>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTagDialogOpen(true)}>
          <Tag className="h-3.5 w-3.5" />
          Add tag
        </Button>
        {canAssignToProject && (
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setProjectDialogOpen(true)}>
              <FolderKanban className="h-3.5 w-3.5" />
              Add to project
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAssigneeDialogOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              Add assignee
            </Button>
          </>
        )}
        <Button variant="destructive" size="sm" className="gap-1.5" onClick={handleDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={clear} aria-label="Clear selection">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <BulkAddTagDialog open={tagDialogOpen} onOpenChange={setTagDialogOpen} ids={ids} onDone={() => { clear(); router.refresh(); }} />
      {canAssignToProject && (
        <>
          <BulkAddToProjectDialog
            open={projectDialogOpen}
            onOpenChange={setProjectDialogOpen}
            artifactIds={ids}
            onDone={() => clear()}
          />
          <BulkAddAssigneeDialog
            open={assigneeDialogOpen}
            onOpenChange={setAssigneeDialogOpen}
            artifactIds={ids}
            onDone={() => { clear(); router.refresh(); }}
          />
        </>
      )}
    </>
  );
}
