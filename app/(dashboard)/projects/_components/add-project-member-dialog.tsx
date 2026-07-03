"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserPicker, type PickedUser } from "@/components/ui/user-picker";
import { toast } from "@/hooks/use-toast";
import { UserPlus } from "lucide-react";

type Props = {
  projectId: string;
  onAdded: () => void;
};

export function AddProjectMemberDialog({ projectId, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<PickedUser | null>(null);

  const add = trpc.project.addMember.useMutation({
    onSuccess: () => {
      onAdded();
      toast({ title: "Member added", variant: "success" });
      setOpen(false);
      setUser(null);
    },
    onError: (e) => toast({ title: "Failed to add member", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" />
        Add member
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a member</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>User</Label>
              <UserPicker value={user} onChange={setUser} disabled={add.isPending} />
              <p className="text-xs text-muted-foreground">
                Must be in the owning group&apos;s scope. Membership is organizational only — it does not
                grant read access.
              </p>
            </div>
            {add.error && <p className="text-sm text-destructive">{add.error.message}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={add.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!user || add.isPending}
              onClick={() => user && add.mutate({ projectId, userId: user.id })}
            >
              {add.isPending ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
