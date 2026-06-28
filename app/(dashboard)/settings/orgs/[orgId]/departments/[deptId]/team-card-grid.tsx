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
import { CreateTeamDialog } from "../../create-team-dialog";

export type TeamCard = { id: string; name: string; slug: string | null; memberCount: number; image?: string | null };

type Props = {
  teams: TeamCard[];
  orgId: string;
  deptId: string;
  deptSlugPath: string;
  isAdmin: boolean;
};

export function TeamCardGrid({ teams, orgId, deptId, deptSlugPath, isAdmin }: Props) {
  const router = useRouter();
  const [editTarget, setEditTarget] = useState<TeamCard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamCard | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const updateTeam = trpc.org.department.team.update.useMutation({
    onSuccess: () => {
      toast({ title: "Team updated", variant: "success" });
      setEditTarget(null);
      router.refresh();
    },
    onError: (e) =>
      toast({ title: "Failed to update team", description: e.message, variant: "destructive" }),
  });

  const deleteTeam = trpc.org.department.team.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Team deleted", variant: "success" });
      setDeleteTarget(null);
      router.refresh();
    },
    onError: (e) =>
      toast({ title: "Failed to delete team", description: e.message, variant: "destructive" }),
  });

  function openEdit(team: TeamCard) {
    setEditName(team.name);
    setEditSlug(team.slug ?? "");
    setEditTarget(team);
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        message="No teams yet."
        action={
          isAdmin ? (
            <CreateTeamDialog departmentId={deptId} deptSlugPath={deptSlugPath} />
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => (
          <Card key={team.id} className="transition-colors hover:bg-muted/30">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <GroupAvatar image={team.image} name={team.name} groupType="team" size="sm" />
                  <CardTitle className="truncate text-sm">{team.name}</CardTitle>
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
                      <DropdownMenuItem onSelect={() => openEdit(team)}>Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeleteTarget(team)}
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
                {team.memberCount} member{team.memberCount !== 1 ? "s" : ""}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={`/settings/orgs/${orgId}/departments/${deptId}/teams/${team.id}`}>
                  View members
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit team</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="et-name">Name</Label>
              <Input
                id="et-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={updateTeam.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="et-slug">
                Slug{" "}
                <span className="ml-1 text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <Input
                id="et-slug"
                placeholder="leave blank for none"
                value={editSlug}
                onChange={(e) =>
                  setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                disabled={updateTeam.isPending}
              />
            </div>
            {updateTeam.error && (
              <p className="text-sm text-destructive">{updateTeam.error.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={updateTeam.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={!editName || updateTeam.isPending}
              onClick={() =>
                editTarget &&
                updateTeam.mutate({
                  teamId: editTarget.id,
                  name: editName !== editTarget.name ? editName : undefined,
                  slug:
                    editSlug !== (editTarget.slug ?? "")
                      ? editSlug || undefined
                      : undefined,
                })
              }
            >
              {updateTeam.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently deleted along with all its
              prompts and memberships. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteTeam.mutate({ teamId: deleteTarget.id })}
              disabled={deleteTeam.isPending}
            >
              {deleteTeam.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
