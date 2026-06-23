"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  groupType: "org" | "department" | "team";
  groupId: string;
  label?: string;
};

export function AddMemberForm({ groupType, groupId, label }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const add = trpc.org.membership.add.useMutation({
    onSuccess: () => { setEmail(""); router.refresh(); },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({ email, groupType, groupId, role: "editor" });
      }}
      className="flex gap-2"
    >
      <div className="flex-1 space-y-1">
        {label && <Label className="text-xs">{label}</Label>}
        <Input
          type="email"
          placeholder="member@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-8 text-sm"
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={add.isPending} className="self-end">
        {add.isPending ? "Adding…" : "Add"}
      </Button>
      {add.error && <p className="text-xs text-destructive">{add.error.message}</p>}
    </form>
  );
}
