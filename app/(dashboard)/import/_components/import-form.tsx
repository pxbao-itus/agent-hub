"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { artifactDetailPath } from "@/lib/artifact-routes";
import type { ArtifactBundle } from "@/server/trpc/routers/artifact";

/**
 * Bundle is parsed client-side only for the preview (best-effort — this is
 * not the source of truth). The import mutation re-validates the full shape
 * server-side with the same zod schema, so a malformed or hand-edited file
 * fails there with a clear error rather than silently doing the wrong thing.
 */
function readAsPreview(raw: unknown): Partial<ArtifactBundle> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Partial<ArtifactBundle>;
}

export function ImportForm() {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<unknown>(null);

  const importMutation = trpc.artifact.import.useMutation({
    onSuccess: (result) => {
      toast({ title: "Imported" });
      router.push(artifactDetailPath(result.kind, result.id));
    },
    onError: (e) => toast({ title: "Failed to import", description: e.message, variant: "destructive" }),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setBundle(null);
    setParseError(null);
    setFileName(file?.name ?? null);
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setBundle(parsed);
    } catch {
      setParseError("Not valid JSON — is this an exported bundle file?");
    }
  }

  const preview = readAsPreview(bundle);
  const isLegacyKit = preview?.kind === "kit";

  return (
    <Card className="max-w-lg">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <input
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            aria-label="Bundle file"
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
          {parseError && <p className="text-xs text-destructive">{parseError}</p>}
        </div>

        {preview && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{preview.title ?? "(untitled)"}</span>
              {preview.kind && <Badge variant="secondary">{preview.kind}</Badge>}
            </div>
            {preview.description && <p className="text-muted-foreground">{preview.description}</p>}
            <div className="flex gap-3 text-xs text-muted-foreground">
              {!!preview.files?.length && <span>{preview.files.length} file(s)</span>}
              {!!preview.tasks?.length && <span>{preview.tasks.length} task(s)</span>}
            </div>
            {isLegacyKit && (
              <p className="text-xs text-destructive">
                Legacy Kit bundles are no longer supported and cannot be imported.
              </p>
            )}
          </div>
        )}

        <Button
          disabled={!bundle || isLegacyKit || importMutation.isPending}
          onClick={() => importMutation.mutate({ bundle: bundle as ArtifactBundle })}
        >
          {importMutation.isPending ? "Importing…" : "Import into my space"}
        </Button>
      </CardContent>
    </Card>
  );
}
