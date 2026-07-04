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

export function DeleteDocButton({ docId }: { docId: string }) {
  const router = useRouter();
  const del = trpc.doc.delete.useMutation();

  function handleConfirm() {
    router.push("/docs");
    runUndoable({
      key: docId,
      message: "Doc deleted",
      commit: () => del.mutateAsync({ id: docId }),
      onCancel: () => router.push(`/docs/${docId}`),
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete doc?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the doc and all its versions. Links from plans will also be removed. You&apos;ll have a few seconds to undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
