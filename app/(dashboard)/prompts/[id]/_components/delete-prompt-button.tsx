"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

export function DeletePromptButton({ promptId }: { promptId: string }) {
  const router = useRouter();
  const del = trpc.prompt.delete.useMutation({
    onSuccess: () => router.push("/prompts"),
  });

  function handleClick() {
    if (!confirm("Delete this prompt and all its versions?")) return;
    del.mutate({ id: promptId });
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleClick} disabled={del.isPending}>
      {del.isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
