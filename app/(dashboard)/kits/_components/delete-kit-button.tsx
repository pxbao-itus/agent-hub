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
import { toast } from "@/hooks/use-toast";

export function DeleteKitButton({ kitId }: { kitId: string }) {
  const router = useRouter();

  const del = trpc.kit.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Kit deleted", variant: "success" });
      router.push("/kits");
    },
    onError: (e) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={del.isPending}>
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this kit?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the kit and all its versions. Member artifacts are not deleted. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => del.mutate({ id: kitId })}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
