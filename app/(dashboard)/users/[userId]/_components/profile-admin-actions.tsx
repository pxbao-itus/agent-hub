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
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { EditUserDialog } from "@/app/(dashboard)/settings/users/_components/edit-user-dialog";

type Props = {
  user: {
    id: string;
    name: string | null;
    username: string | null;
    email: string;
    systemRole: "user" | "superadmin";
    hasPassword: boolean;
  };
  currentUserId: string;
};

export function ProfileAdminActions({ user, currentUserId }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmRole, setConfirmRole] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const role = trpc.user.setSystemRole.useMutation({
    onSuccess: () => {
      setConfirmRole(false);
      toast({ title: "Role updated", variant: "success" });
      router.refresh();
    },
    onError: (error) =>
      toast({ title: "Failed to update role", description: error.message, variant: "destructive" }),
  });
  const remove = trpc.user.delete.useMutation({
    onSuccess: () => {
      toast({ title: "User deleted", variant: "success" });
      router.push("/settings/users");
      router.refresh();
    },
    onError: (error) =>
      toast({ title: "Failed to delete user", description: error.message, variant: "destructive" }),
  });
  const nextRole = user.systemRole === "superadmin" ? "user" : "superadmin";
  const isSelf = user.id === currentUserId;

  return (
    <>
      <div className="space-y-2">
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setEditing(true)}>
          Edit user
        </Button>
        {!isSelf && (
          <>
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setConfirmRole(true)}>
              {nextRole === "superadmin" ? "Make superadmin" : "Remove superadmin"}
            </Button>
            <Button type="button" variant="destructive" size="sm" className="w-full" onClick={() => setConfirmDelete(true)}>
              Delete user
            </Button>
          </>
        )}
      </div>

      <EditUserDialog
        user={editing ? {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          hasPassword: user.hasPassword,
        } : null}
        onClose={() => setEditing(false)}
      />

      <AlertDialog open={confirmRole} onOpenChange={setConfirmRole}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{nextRole === "superadmin" ? "Grant superadmin?" : "Remove superadmin?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {nextRole === "superadmin"
                ? `${user.email} will receive unrestricted platform access.`
                : `${user.email} will lose unrestricted platform access.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => role.mutate({ userId: user.id, role: nextRole })}
              disabled={role.isPending}
            >
              {role.isPending ? "Updating…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.email} and their personal artifacts will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate({ userId: user.id })}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
