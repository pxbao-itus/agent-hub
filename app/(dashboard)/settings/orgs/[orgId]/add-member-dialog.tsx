"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPicker, type PickedUser } from "@/components/ui/user-picker";
import { toast } from "@/hooks/use-toast";
import { UserPlus } from "lucide-react";

type Props = {
  groupType: "org" | "department" | "team";
  groupId: string;
};

export function AddMemberDialog({ groupType, groupId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<PickedUser | null>(null);
  const [role, setRole] = useState<"viewer" | "editor" | "admin">("editor");

  const add = trpc.org.membership.add.useMutation({
    onSuccess: () => {
      toast({ title: "Member added", variant: "success" });
      setOpen(false);
      setUser(null);
      setRole("editor");
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to add member", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1.5 h-4 w-4" />
        Add member
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>User</Label>
              <UserPicker value={user} onChange={setUser} disabled={add.isPending} />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)} disabled={add.isPending}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer — can read prompts</SelectItem>
                  <SelectItem value="editor">Editor — can create & edit prompts</SelectItem>
                  <SelectItem value="admin">Admin — full management access</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {add.error && <p className="text-sm text-destructive">{add.error.message}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={add.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!user || add.isPending}
              onClick={() => user && add.mutate({ userId: user.id, groupType, groupId, role })}
            >
              {add.isPending ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
