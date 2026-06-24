"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { MoreHorizontal, ChevronLeft, ChevronRight, Search } from "lucide-react";

type User = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  systemRole: "user" | "superadmin";
  createdAt: Date;
  orgCount: number;
};

type Props = {
  users: User[];
  currentUserId: string;
  query: string;
  offset: number;
  limit: number;
  hasMore: boolean;
};

type RoleAction = { userId: string; email: string; role: "user" | "superadmin" } | null;

export function UserTable({ users, currentUserId, query, offset, limit, hasMore }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [isPending, startTransition] = useTransition();
  const [roleAction, setRoleAction] = useState<RoleAction>(null);

  const setSystemRole = trpc.user.setSystemRole.useMutation({
    onSuccess: () => {
      toast({ title: "Role updated", variant: "success" });
      setRoleAction(null);
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to update role", description: e.message, variant: "destructive" }),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      router.push(`/settings/users?${params.toString()}`);
    });
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
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Orgs</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Joined</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
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
                      <p className={`truncate text-muted-foreground ${!u.name ? "font-medium text-foreground" : "text-xs"}`}>
                        {u.email}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <Badge variant={u.systemRole === "superadmin" ? "default" : "outline"}>
                    {u.systemRole}
                  </Badge>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                  {u.orgCount}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                  {u.createdAt.toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {u.id !== currentUserId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {u.systemRole === "superadmin" ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setRoleAction({ userId: u.id, email: u.email, role: "user" })}
                          >
                            Remove superadmin
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() => setRoleAction({ userId: u.id, email: u.email, role: "superadmin" })}
                          >
                            Make superadmin
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {offset + 1}–{offset + users.length}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => {
              const params = new URLSearchParams();
              if (query) params.set("q", query);
              const prev = Math.max(0, offset - limit);
              if (prev > 0) params.set("offset", String(prev));
              router.push(`/settings/users?${params.toString()}`);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => {
              const params = new URLSearchParams();
              if (query) params.set("q", query);
              params.set("offset", String(offset + limit));
              router.push(`/settings/users?${params.toString()}`);
            }}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
    </>
  );
}
