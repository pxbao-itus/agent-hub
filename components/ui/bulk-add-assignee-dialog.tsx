"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPicker, type PickedUser } from "@/components/ui/user-picker";
import { toast } from "@/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactIds: string[];
  onDone: () => void;
};

export function BulkAddAssigneeDialog({ open, onOpenChange, artifactIds, onDone }: Props) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const assign = trpc.assignment.bulkAddAssignee.useMutation({
    onSuccess: (result) => {
      onOpenChange(false);
      setUser(null);
      onDone();
      const completed = result.assigned.length;
      const unchanged = result.alreadyAssigned.length;
      const failed = result.failed.length;
      toast({
        title: `Assigned ${completed}, unchanged ${unchanged}, failed ${failed}`,
        description: failed
          ? result.failed.slice(0, 3).map((item) => item.reason).join(" ")
          : undefined,
        variant: failed ? "default" : "success",
      });
    },
    onError: (error) => toast({ title: "Bulk assignment failed", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an assignee to {artifactIds.length} item(s)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <UserPicker
            value={user}
            onChange={setUser}
            disabled={assign.isPending}
            emptyHint="No users found. Items the selected user cannot access will be reported as failed."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={!user || assign.isPending}
              onClick={() => user && assign.mutate({ artifactIds, userId: user.id })}
            >
              {assign.isPending ? "Assigning…" : "Add assignee"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
