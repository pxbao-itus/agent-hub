"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "./badge";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./alert-dialog";
import { toast } from "@/hooks/use-toast";
import { MoreHorizontal } from "lucide-react";
import type { BadgeProps } from "./badge";

export type Member = {
  id: string;
  userId: string;
  role: "viewer" | "editor" | "admin";
  userName: string | null;
  userEmail: string;
};

const ROLES: Array<"viewer" | "editor" | "admin"> = ["viewer", "editor", "admin"];

function roleBadgeVariant(role: string): BadgeProps["variant"] {
  if (role === "admin") return "default";
  if (role === "editor") return "secondary";
  return "outline";
}

type Props = {
  members: Member[];
  isAdmin: boolean;
  currentUserId: string;
};

export function MemberList({ members, isAdmin, currentUserId }: Props) {
  const router = useRouter();
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const updateRole = trpc.org.membership.updateRole.useMutation({
    onSuccess: () => {
      toast({ title: "Role updated", variant: "success" });
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to update role", description: e.message, variant: "destructive" }),
  });

  const remove = trpc.org.membership.remove.useMutation({
    onSuccess: () => {
      toast({ title: "Member removed", variant: "success" });
      setRemoveTarget(null);
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to remove member", description: e.message, variant: "destructive" }),
  });

  if (members.length === 0) {
    return <EmptyState message="No members yet." />;
  }

  return (
    <>
      <div className="divide-y rounded-md border">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{m.userName ?? m.userEmail}</p>
              <p className="truncate text-xs text-muted-foreground">{m.userEmail}</p>
            </div>
            <div className="ml-4 flex shrink-0 items-center gap-2">
              <Badge variant={roleBadgeVariant(m.role)}>{m.role}</Badge>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Member actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Change role</DropdownMenuLabel>
                    {ROLES.map((role) => (
                      <DropdownMenuItem
                        key={role}
                        disabled={m.role === role || updateRole.isPending}
                        className={m.role === role ? "font-medium" : ""}
                        onSelect={() => updateRole.mutate({ membershipId: m.id, role })}
                      >
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                        {m.role === role && " ✓"}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setRemoveTarget(m)}
                    >
                      Remove member
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.userName ?? removeTarget?.userEmail} will lose access to this group and its prompts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeTarget && remove.mutate({ membershipId: removeTarget.id })}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
