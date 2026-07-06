"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { runUndoable } from "@/lib/undoable-action";

export function DeleteWorkflowButton({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const del = trpc.workflow.delete.useMutation();

  function handleConfirm() {
    router.push("/workflows");
    runUndoable({
      key: workflowId,
      message: "Workflow deleted",
      commit: () => del.mutateAsync({ id: workflowId }),
      onCancel: () => router.push(`/workflows/${workflowId}`),
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this workflow?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the workflow and all its stages/attachments. The attached artifacts and any
            linked project are not deleted. You&apos;ll have a few seconds to undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
