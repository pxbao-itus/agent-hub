"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { slugify } from "@/lib/slug";

export function ExportArtifactButton({ artifactId, title }: { artifactId: string; title: string }) {
  const utils = trpc.useUtils();
  const [pending, setPending] = useState(false);

  async function handleExport() {
    setPending(true);
    try {
      const bundle = await utils.artifact.export.fetch({ id: artifactId });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(title, "artifact")}.agenthub.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: "Failed to export",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={handleExport}>
      {pending ? "Exporting…" : "Export"}
    </Button>
  );
}
