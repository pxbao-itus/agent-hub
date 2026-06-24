"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");
}

type Props = {
  departmentId: string;
  deptSlugPath: string;
};

export function CreateTeamDialog({ departmentId, deptSlugPath }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const create = trpc.org.department.team.create.useMutation({
    onSuccess: () => {
      toast({ title: "Team created", variant: "success" });
      setOpen(false);
      setName(""); setSlug(""); setSlugTouched(false);
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to create team", description: e.message, variant: "destructive" }),
  });

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New team
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Backend"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={create.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-sm text-muted-foreground">{deptSlugPath}.</span>
                <Input
                  placeholder="backend"
                  value={slug}
                  onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                  className="font-mono"
                  disabled={create.isPending}
                />
              </div>
              <p className="text-xs text-muted-foreground">Used in MCP slash command paths.</p>
            </div>
            {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!name || create.isPending}
              onClick={() => create.mutate({ departmentId, name, slug: slug || undefined })}
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
