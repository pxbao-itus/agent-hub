"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function clientSlugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CreateTeamForm({
  departmentId,
  deptSlugPath,
}: {
  departmentId: string;
  deptSlugPath: string; // e.g. "acme.engineering" — shown as prefix
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!slugTouched) setSlug(clientSlugify(name));
  }, [name, slugTouched]);

  const create = trpc.org.department.team.create.useMutation({
    onSuccess: () => { setName(""); setSlug(""); setSlugTouched(false); router.refresh(); },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ departmentId, name, slug: slug || undefined });
      }}
      className="space-y-3"
    >
      <div className="flex gap-2">
        <Input
          placeholder="Team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-xs"
          required
        />
        <Button type="submit" size="sm" variant="outline" disabled={create.isPending} className="h-7 text-xs shrink-0">
          {create.isPending ? "…" : "Add team"}
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground shrink-0">{deptSlugPath}.</span>
        <Input
          placeholder="slug"
          value={slug}
          onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
          className="h-7 text-[11px] font-mono"
        />
      </div>
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
    </form>
  );
}
