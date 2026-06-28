"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Trash2 } from "lucide-react";

interface DeleteOrgDialogProps {
  orgId: string;
  orgName: string;
}

export function DeleteOrgDialog({ orgId, orgName }: DeleteOrgDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const deleteOrg = trpc.org.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Organization deleted", variant: "success" });
      router.push("/settings/orgs");
    },
    onError: (err: { message: string }) =>
      toast({ title: "Failed to delete organization", description: err.message, variant: "destructive" }),
  });

  const canDelete = confirmName === orgName;

  function handleDelete() {
    if (!canDelete) return;
    deleteOrg.mutate({ orgId });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setConfirmName("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete organization
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{orgName}&rdquo;</DialogTitle>
          <DialogDescription>
            This will permanently delete the organization and all its departments, teams,
            memberships, and prompts. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label htmlFor="confirm-name">
            Type <span className="font-mono font-semibold">{orgName}</span> to confirm
          </Label>
          <Input
            id="confirm-name"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={orgName}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete || deleteOrg.isPending}
            onClick={handleDelete}
          >
            {deleteOrg.isPending ? "Deleting…" : "Delete organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
