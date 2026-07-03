"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { artifactDetailPath } from "@/lib/artifact-routes";
import type { ArtifactKind } from "@/server/db/schema";

export function DuplicateArtifactButton({ artifactId, kind }: { artifactId: string; kind: ArtifactKind }) {
  const router = useRouter();

  const duplicate = trpc.artifact.duplicate.useMutation({
    onSuccess: (copy) => {
      const skipped = copy.skippedMembers;
      toast({
        title: "Duplicated",
        description: skipped
          ? `${skipped} member${skipped === 1 ? "" : "s"} you don't have access to were left out.`
          : undefined,
      });
      router.push(artifactDetailPath(kind, copy.id));
    },
    onError: (e) => toast({ title: "Failed to duplicate", description: e.message, variant: "destructive" }),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={duplicate.isPending}
      onClick={() => duplicate.mutate({ sourceId: artifactId })}
    >
      {duplicate.isPending ? "Duplicating…" : "Duplicate"}
    </Button>
  );
}
