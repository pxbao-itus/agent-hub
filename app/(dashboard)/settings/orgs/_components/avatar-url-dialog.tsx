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
import { Camera } from "lucide-react";

type GroupType = "org" | "department" | "team";

interface AvatarUrlDialogProps {
  groupType: GroupType;
  groupId: string;
  currentImage?: string | null;
}

export function AvatarUrlDialog({ groupType, groupId, currentImage }: AvatarUrlDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(currentImage ?? "");
  const [previewError, setPreviewError] = useState(false);

  const setImage = trpc.org.setGroupImage.useMutation({
    onSuccess: () => {
      toast({ title: "Avatar updated", variant: "success" });
      router.refresh();
      setOpen(false);
    },
    onError: (err: { message: string }) =>
      toast({ title: "Failed to update avatar", description: err.message, variant: "destructive" }),
  });

  const trimmed = url.trim();
  const showPreview = trimmed.length > 0 && !previewError;

  function handleSave() {
    setImage.mutate({ groupType, groupId, image: trimmed || null });
  }

  function handleRemove() {
    setImage.mutate({ groupType, groupId, image: null });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setUrl(currentImage ?? "");
          setPreviewError(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Camera className="mr-2 h-4 w-4" />
          Change avatar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set avatar</DialogTitle>
          <DialogDescription>
            Paste a public image URL (png, jpg, webp, gif, svg). Max 1MB.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="avatar-url">Image URL</Label>
            <Input
              id="avatar-url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreviewError(false); }}
              placeholder="https://example.com/avatar.png"
              autoComplete="off"
            />
          </div>

          {showPreview && (
            <div className="flex items-center gap-3">
              <img
                src={trimmed}
                alt="Preview"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setPreviewError(true)}
                className="h-14 w-14 rounded-full object-cover border"
              />
              <span className="text-xs text-muted-foreground">Preview</span>
            </div>
          )}
          {previewError && trimmed.length > 0 && (
            <p className="text-xs text-destructive">Cannot load image — check the URL.</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {currentImage && (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={setImage.isPending}
              className="mr-auto text-destructive hover:text-destructive"
            >
              Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={setImage.isPending}>
            {setImage.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
