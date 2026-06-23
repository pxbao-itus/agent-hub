"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateTeamForm({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const create = trpc.org.department.team.create.useMutation({
    onSuccess: () => { setName(""); router.refresh(); },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ departmentId, name });
      }}
      className="flex gap-2 pt-2"
    >
      <Input
        placeholder="New team name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-7 text-xs"
        required
      />
      <Button type="submit" size="sm" variant="outline" disabled={create.isPending} className="h-7 text-xs">
        {create.isPending ? "…" : "Add team"}
      </Button>
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
    </form>
  );
}
