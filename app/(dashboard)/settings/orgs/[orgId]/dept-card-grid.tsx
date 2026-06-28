"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { MoreHorizontal } from "lucide-react";
import { GroupAvatar } from "@/components/ui/group-avatar";
import { CreateDeptDialog } from "./create-dept-dialog";

export type DeptCard = { id: string; name: string; slug: string | null; memberCount: number; image?: string | null };

type Props = {
  depts: DeptCard[];
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
};

export function DeptCardGrid({ depts, orgId, orgSlug, isAdmin }: Props) {
  const router = useRouter();
  const [editTarget, setEditTarget] = useState<DeptCard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeptCard | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const updateDept = trpc.org.department.update.useMutation({
    onSuccess: () => {
      toast({ title: "Department updated", variant: "success" });
      setEditTarget(null);
      router.refresh();
    },
    onError: (e) =>
      toast({ title: "Failed to update department", description: e.message, variant: "destructive" }),
  });

  const deleteDept = trpc.org.department.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Department deleted", variant: "success" });
      setDeleteTarget(null);
      router.refresh();
    },
    onError: (e) =>
      toast({ title: "Failed to delete department", description: e.message, variant: "destructive" }),
  });

  function openEdit(dept: DeptCard) {
    setEditName(dept.name);
    setEditSlug(dept.slug ?? "");
    setEditTarget(dept);
  }

  if (depts.length === 0) {
    return (
      <EmptyState
        message="No departments yet."
        action={isAdmin ? <CreateDeptDialog orgId={orgId} orgSlug={orgSlug} /> : undefined}
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {depts.map((dept) => (
          <Card key={dept.id} className="transition-colors hover:bg-muted/30">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <GroupAvatar image={dept.image} name={dept.name} groupType="department" size="sm" />
                  <CardTitle className="truncate text-sm">{dept.name}</CardTitle>
                </div>
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openEdit(dept)}>Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeleteTarget(dept)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {dept.memberCount} member{dept.memberCount !== 1 ? "s" : ""}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={`/settings/orgs/${orgId}/departments/${dept.id}`}>View teams</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit department</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="ed-name">Name</Label>
              <Input
                id="ed-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={updateDept.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-slug">
                Slug{" "}
                <span className="ml-1 text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <Input
                id="ed-slug"
                placeholder="leave blank for none"
                value={editSlug}
                onChange={(e) =>
                  setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                disabled={updateDept.isPending}
              />
            </div>
            {updateDept.error && (
              <p className="text-sm text-destructive">{updateDept.error.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={updateDept.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={!editName || updateDept.isPending}
              onClick={() =>
                editTarget &&
                updateDept.mutate({
                  departmentId: editTarget.id,
                  name: editName !== editTarget.name ? editName : undefined,
                  slug:
                    editSlug !== (editTarget.slug ?? "")
                      ? editSlug || undefined
                      : undefined,
                })
              }
            >
              {updateDept.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete department?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently deleted along with all its
              teams, prompts, and memberships. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteTarget && deleteDept.mutate({ departmentId: deleteTarget.id })
              }
              disabled={deleteDept.isPending}
            >
              {deleteDept.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
