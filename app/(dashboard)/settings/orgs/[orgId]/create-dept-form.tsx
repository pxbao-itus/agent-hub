"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

function clientSlugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CreateDeptForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!slugTouched) setSlug(clientSlugify(name));
  }, [name, slugTouched]);

  const create = trpc.org.department.create.useMutation({
    onSuccess: () => {
      toast({ title: "Department created", variant: "success" });
      setName(""); setSlug(""); setSlugTouched(false); router.refresh();
    },
    onError: (e) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ orgId, name, slug: slug || undefined });
      }}
      className="space-y-3 max-w-sm"
    >
      <div className="space-y-1">
        <Label htmlFor="dept-name" className="text-xs">Department name</Label>
        <Input
          id="dept-name"
          placeholder="Engineering"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-sm"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dept-slug" className="text-xs">
          Slug <span className="text-muted-foreground font-normal">— prompt namespace in MCP</span>
        </Label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{orgSlug}.</span>
          <Input
            id="dept-slug"
            placeholder="engineering"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={create.isPending}>
        {create.isPending ? "Creating…" : "Create department"}
      </Button>
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
    </form>
  );
}
