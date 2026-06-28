"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { diffLines } from "@/lib/diff-lines";

type Version = {
  id: string;
  versionNo: number;
  body: string;
  changelog: string | null;
  createdAt: Date;
};

type Props = {
  promptId: string;
  versions: Version[];
  currentVersionId: string | null;
  canEdit: boolean;
};

export function VersionHistory({ promptId, versions, currentVersionId, canEdit }: Props) {
  const router = useRouter();
  const [viewVersion, setViewVersion] = useState<Version | null>(null);
  const [diffBase, setDiffBase] = useState<number | null>(null);
  const [diffCompare, setDiffCompare] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<Version | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const rollback = trpc.prompt.rollback.useMutation({
    onSuccess: (data) => {
      toast({ title: `Rolled back to v${rollbackTarget?.versionNo}`, description: `New version v${data.newVersionNo} created.`, variant: "success" });
      setRollbackTarget(null);
      router.refresh();
    },
    onError: (e) => toast({ title: "Rollback failed", description: e.message, variant: "destructive" }),
  });

  const currentVersion = versions.find((v) => v.id === currentVersionId);
  const isCurrentVersion = (v: Version) => v.id === currentVersionId;

  // Compute diff lines when both selected
  const diffResult =
    showDiff && diffBase !== null && diffCompare !== null
      ? diffLines(
          versions.find((v) => v.versionNo === diffBase)?.body ?? "",
          versions.find((v) => v.versionNo === diffCompare)?.body ?? "",
        )
      : null;

  return (
    <>
      <div className="divide-y rounded-md border">
        {versions.map((v) => (
          <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-sm font-medium">v{v.versionNo}</span>
              {isCurrentVersion(v) && (
                <Badge variant="secondary" className="shrink-0 text-xs">current</Badge>
              )}
              {v.changelog && (
                <span className="truncate text-sm text-muted-foreground">{v.changelog}</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(v.createdAt).toLocaleDateString()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setViewVersion(v)}
              >
                View
              </Button>
              {canEdit && !isCurrentVersion(v) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setRollbackTarget(v)}
                >
                  Rollback
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Diff section — only show when ≥2 versions */}
      {versions.length >= 2 && (
        <div className="rounded-md border">
          <button
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/40 transition-colors rounded-md"
            onClick={() => setShowDiff((v) => !v)}
          >
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Compare versions</span>
            <span className="text-muted-foreground text-xs">{showDiff ? "▲" : "▼"}</span>
          </button>
          {showDiff && (
            <div className="border-t px-4 py-3 space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">From</span>
                  <select
                    className="rounded border bg-background px-2 py-1 text-xs"
                    value={diffBase ?? ""}
                    onChange={(e) => setDiffBase(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— select —</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.versionNo}>v{v.versionNo}</option>
                    ))}
                  </select>
                </div>
                <span className="text-muted-foreground">→</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">To</span>
                  <select
                    className="rounded border bg-background px-2 py-1 text-xs"
                    value={diffCompare ?? ""}
                    onChange={(e) => setDiffCompare(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— select —</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.versionNo}>v{v.versionNo}</option>
                    ))}
                  </select>
                </div>
              </div>

              {diffResult && (
                <pre className="overflow-x-auto rounded-md border font-mono text-xs leading-relaxed">
                  {diffResult.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.type === "add"
                          ? "bg-success/10 text-success px-3 py-0.5"
                          : line.type === "remove"
                            ? "bg-destructive/10 text-destructive px-3 py-0.5"
                            : "px-3 py-0.5 text-muted-foreground"
                      }
                    >
                      <span className="mr-2 select-none opacity-60">
                        {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                      </span>
                      {line.line}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* View version dialog */}
      <Dialog open={!!viewVersion} onOpenChange={(o) => !o && setViewVersion(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              v{viewVersion?.versionNo}
              {viewVersion && isCurrentVersion(viewVersion) && (
                <Badge variant="secondary" className="text-xs">current</Badge>
              )}
            </DialogTitle>
            {viewVersion?.changelog && (
              <p className="text-sm text-muted-foreground">{viewVersion.changelog}</p>
            )}
          </DialogHeader>
          <pre className="overflow-x-auto max-h-[60vh] rounded-lg border bg-muted/40 p-4 font-mono text-sm whitespace-pre-wrap">
            {viewVersion?.body}
          </pre>
          {canEdit && viewVersion && !isCurrentVersion(viewVersion) && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setViewVersion(null);
                  setRollbackTarget(viewVersion);
                }}
              >
                Rollback to this version
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rollback confirm dialog */}
      <AlertDialog open={!!rollbackTarget} onOpenChange={(o) => !o && setRollbackTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback to v{rollbackTarget?.versionNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new version (v{(currentVersion?.versionNo ?? 0) + 1}) with the body from v{rollbackTarget?.versionNo}.
              No history is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                rollbackTarget &&
                rollback.mutate({ promptId, toVersionNo: rollbackTarget.versionNo })
              }
              disabled={rollback.isPending}
            >
              {rollback.isPending ? "Rolling back…" : "Rollback"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
