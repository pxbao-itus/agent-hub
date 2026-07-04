"use client";

import { useState } from "react";
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

export function DeletePromptButton({ promptId }: { promptId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const del = trpc.prompt.delete.useMutation();

  function handleConfirm() {
    router.push("/prompts");
    runUndoable({
      key: promptId,
      message: "Prompt deleted",
      commit: () => del.mutateAsync({ id: promptId }),
      onCancel: () => router.push(`/prompts/${promptId}`),
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete prompt?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the prompt and all its versions. You&apos;ll have a few seconds to undo.
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
