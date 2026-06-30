"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { UserPicker, type PickedUser } from "@/components/ui/user-picker";
import { toast } from "@/hooks/use-toast";
import { Share2, Trash2 } from "lucide-react";

type ShareRole = "viewer" | "editor";

const ROLE_LABELS: Record<ShareRole, string> = {
  viewer: "Viewer (read-only)",
  editor: "Editor (can edit)",
};

type Props = {
  artifactId: string;
  artifactTitle: string;
};

export function ShareDialog({ artifactId, artifactTitle }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PickedUser | null>(null);
  const [newRole, setNewRole] = useState<ShareRole>("viewer");
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);

  const utils = trpc.useUtils();

  const { data: shares = [], isLoading } = trpc.share.list.useQuery(
    { artifactId },
    { enabled: open },
  );

  const add = trpc.share.add.useMutation({
    onSuccess: () => {
      setSelectedUser(null);
      utils.share.list.invalidate({ artifactId });
      toast({ title: "Share added", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to share", description: e.message, variant: "destructive" }),
  });

  const updateRole = trpc.share.updateRole.useMutation({
    onSuccess: () => {
      utils.share.list.invalidate({ artifactId });
      toast({ title: "Role updated", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const remove = trpc.share.remove.useMutation({
    onSuccess: () => {
      setRemoveTarget(null);
      utils.share.list.invalidate({ artifactId });
      toast({ title: "Share removed", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
  });

  function handleAdd() {
    if (!selectedUser) return;
    add.mutate({ artifactId, userId: selectedUser.id, role: newRole });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share &quot;{artifactTitle}&quot;</DialogTitle>
            <DialogDescription>
              Share this artifact with specific users. Viewer = read-only. Editor = can edit.
            </DialogDescription>
          </DialogHeader>

          {/* Add new share */}
          <div className="space-y-3 border-b pb-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Add person</p>
              <UserPicker value={selectedUser} onChange={setSelectedUser} />
            </div>
            <div className="flex items-center gap-2">
              <Select value={newRole} onValueChange={(v) => setNewRole(v as ShareRole)}>
                <SelectTrigger className="flex-1 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                  <SelectItem value="editor">Editor (can edit)</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!selectedUser || add.isPending}
              >
                {add.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>

          {/* Existing shares */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {isLoading ? "Loading…" : shares.length === 0 ? "Not shared with anyone" : `Shared with ${shares.length} person${shares.length !== 1 ? "s" : ""}`}
            </p>
            {shares.map((s) => {
              const grantee = s.user;
              const displayName = grantee?.name ?? grantee?.email ?? "Unknown";
              const initial = (displayName[0] ?? "?").toUpperCase();

              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                    {initial}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    {grantee?.name && (
                      <p className="text-xs text-muted-foreground truncate">{grantee.email}</p>
                    )}
                  </div>
                  <Select
                    value={s.role}
                    onValueChange={(v) =>
                      updateRole.mutate({ artifactId, userId: s.userId, role: v as ShareRole })
                    }
                    disabled={updateRole.isPending}
                  >
                    <SelectTrigger className="w-[130px] text-xs h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer" className="text-xs">Viewer</SelectItem>
                      <SelectItem value="editor" className="text-xs">Editor</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setRemoveTarget({ userId: s.userId, name: displayName })}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove share"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove share?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.name} will lose access to this artifact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                removeTarget && remove.mutate({ artifactId, userId: removeTarget.userId })
              }
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
