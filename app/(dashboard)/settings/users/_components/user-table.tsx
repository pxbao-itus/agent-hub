"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { MoreHorizontal, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EditUserDialog } from "./edit-user-dialog";

export type UserRow = {
  id: string;
  name: string | null;
  username: string | null;
  email: string;
  image: string | null;
  systemRole: "user" | "superadmin";
  hasPassword: boolean;
  createdAt: Date;
  orgCount: number;
};

type Props = {
  users: UserRow[];
  currentUserId: string;
  query: string;
  offset: number;
  limit: number;
  hasMore: boolean;
};

type RoleAction = { userId: string; email: string; role: "user" | "superadmin" } | null;
type DeleteTarget = { userId: string; email: string } | null;

export function UserTable({ users, currentUserId, query, offset, limit, hasMore }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [isPending, startTransition] = useTransition();
  const [roleAction, setRoleAction] = useState<RoleAction>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);

  const setSystemRole = trpc.user.setSystemRole.useMutation({
    onSuccess: () => {
      toast({ title: "Role updated", variant: "success" });
      setRoleAction(null);
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to update role", description: e.message, variant: "destructive" }),
  });

  const deleteUser = trpc.user.delete.useMutation({
    onSuccess: () => {
      toast({ title: "User deleted", variant: "success" });
      setDeleteTarget(null);
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to delete user", description: e.message, variant: "destructive" }),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      router.push(`/settings/users?${params.toString()}`);
    });
  }

  function navigate(newOffset: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (newOffset > 0) params.set("offset", String(newOffset));
    router.push(`/settings/users?${params.toString()}`);
  }

  return (
    <>
      <form onSubmit={handleSearch} className="flex gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline" disabled={isPending}>Search</Button>
      </form>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">User</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Role</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Auth</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Orgs</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Joined</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users found.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {((u.name ?? u.email)[0] ?? "?").toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      {u.name && <p className="truncate font-medium">{u.name}</p>}
                      {u.username && <p className="truncate text-xs text-muted-foreground">@{u.username}</p>}
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <Badge variant={u.systemRole === "superadmin" ? "default" : "outline"}>
                    {u.systemRole}
                  </Badge>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs text-muted-foreground">
                    {u.hasPassword ? "Password" : "OAuth only"}
                  </span>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                  {u.orgCount}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                  {u.createdAt.toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditTarget(u)}>
                        Edit
                      </DropdownMenuItem>
                      {u.id !== currentUserId && (
                        <>
                          <DropdownMenuItem
                            onSelect={() =>
                              setRoleAction({
                                userId: u.id,
                                email: u.email,
                                role: u.systemRole === "superadmin" ? "user" : "superadmin",
                              })
                            }
                          >
                            {u.systemRole === "superadmin" ? "Remove superadmin" : "Make superadmin"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteTarget({ userId: u.id, email: u.email })}
                          >
                            Delete user
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {users.length > 0 ? `Showing ${offset + 1}–${offset + users.length}` : "No results"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => navigate(Math.max(0, offset - limit))}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => navigate(offset + limit)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Edit dialog */}
      <EditUserDialog
        user={editTarget ? {
          id: editTarget.id,
          name: editTarget.name,
          username: editTarget.username,
          email: editTarget.email,
          hasPassword: editTarget.hasPassword,
        } : null}
        onClose={() => setEditTarget(null)}
      />

      {/* Toggle superadmin AlertDialog */}
      <AlertDialog open={!!roleAction} onOpenChange={(open) => !open && setRoleAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {roleAction?.role === "superadmin" ? "Grant superadmin?" : "Remove superadmin?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {roleAction?.role === "superadmin"
                ? `${roleAction.email} will have full access to all resources and users.`
                : `${roleAction?.email} will lose superadmin privileges.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={roleAction?.role === "user" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              onClick={() => roleAction && setSystemRole.mutate({ userId: roleAction.userId, role: roleAction.role })}
              disabled={setSystemRole.isPending}
            >
              {setSystemRole.isPending ? "Updating…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete AlertDialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.email}</strong> will be permanently deleted along with all their personal prompts and memberships. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteUser.mutate({ userId: deleteTarget.userId })}
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
