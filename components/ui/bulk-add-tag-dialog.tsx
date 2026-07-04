"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  onDone: () => void;
};

export function BulkAddTagDialog({ open, onOpenChange, ids, onDone }: Props) {
  const [tag, setTag] = useState("");

  const bulkAddTag = trpc.artifact.bulkAddTag.useMutation({
    onSuccess: (result) => {
      onOpenChange(false);
      onDone();
      setTag("");
      if (result.skippedIds.length > 0) {
        toast({
          title: `Tagged ${result.updatedIds.length}, skipped ${result.skippedIds.length}`,
          description: "You may not have permission to edit the skipped items.",
        });
      } else {
        toast({ title: `Tagged ${result.updatedIds.length} item(s)`, variant: "success" });
      }
    },
    onError: (e) => toast({ title: "Failed to add tag", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a tag to {ids.length} item(s)</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tag.trim()) bulkAddTag.mutate({ ids, tag: tag.trim() });
          }}
          className="space-y-3"
        >
          <div className="space-y-2">
            <Label htmlFor="bulk-tag">Tag</Label>
            <Input id="bulk-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. urgent" autoFocus />
          </div>
          {bulkAddTag.error && <p className="text-sm text-destructive">{bulkAddTag.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!tag.trim() || bulkAddTag.isPending}>
              {bulkAddTag.isPending ? "Adding…" : "Add tag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
