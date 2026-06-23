"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateDeptForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const create = trpc.org.department.create.useMutation({
    onSuccess: () => { setName(""); router.refresh(); },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ orgId, name });
      }}
      className="flex max-w-sm gap-2"
    >
      <div className="flex-1 space-y-1">
        <Label htmlFor="dept-name" className="text-xs">New department</Label>
        <Input
          id="dept-name"
          placeholder="Engineering"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-sm"
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={create.isPending} className="self-end">
        {create.isPending ? "Creating…" : "Create"}
      </Button>
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
    </form>
  );
}
