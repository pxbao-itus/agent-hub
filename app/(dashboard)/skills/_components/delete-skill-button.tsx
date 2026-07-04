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

export function DeleteSkillButton({ skillId }: { skillId: string }) {
  const router = useRouter();
  const del = trpc.skill.delete.useMutation();

  function handleConfirm() {
    router.push("/skills");
    runUndoable({
      key: skillId,
      message: "Skill deleted",
      commit: () => del.mutateAsync({ id: skillId }),
      onCancel: () => router.push(`/skills/${skillId}`),
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
          <AlertDialogTitle>Delete this skill?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the skill and all its versions. You&apos;ll have a few seconds to undo.
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
