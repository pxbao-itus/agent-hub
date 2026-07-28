"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  /** Extra content shown below the body in the "View" dialog (e.g. skill bundled files). */
  extra?: ReactNode;
};

type Props = {
  versions: Version[];
  currentVersionId: string | null | undefined;
  canEdit: boolean;
  onRollback: (toVersionNo: number) => Promise<{ newVersionNo: number }>;
};

/** Generic version list + view/diff/rollback UI, shared by all artifact kinds. */
export function VersionHistoryView({ versions, currentVersionId, canEdit, onRollback }: Props) {
  const router = useRouter();
  const [viewVersion, setViewVersion] = useState<Version | null>(null);
  const [diffBase, setDiffBase] = useState<number | null>(null);
  const [diffCompare, setDiffCompare] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<Version | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [rollbackPending, setRollbackPending] = useState(false);

  if (!versions.length) return null;

  const isCurrentVersion = (v: Version) => v.id === currentVersionId;
  const nextVersionNo = Math.max(...versions.map((v) => v.versionNo)) + 1;

  const diffResult =
    compareOpen && diffBase !== null && diffCompare !== null
      ? diffLines(
          versions.find((v) => v.versionNo === diffBase)?.body ?? "",
          versions.find((v) => v.versionNo === diffCompare)?.body ?? "",
        )
      : null;

  function openCompare() {
    const newest = versions.find(isCurrentVersion) ?? versions[0];
    const previous = [...versions]
      .filter((v) => v.versionNo < newest.versionNo)
      .sort((a, b) => b.versionNo - a.versionNo)[0];
    setDiffCompare(newest.versionNo);
    setDiffBase(previous?.versionNo ?? null);
    setCompareOpen(true);
  }

  async function handleRollback() {
    if (!rollbackTarget) return;
    setRollbackPending(true);
    try {
      const data = await onRollback(rollbackTarget.versionNo);
      toast({
        title: `Rolled back to v${rollbackTarget.versionNo}`,
        description: `New version v${data.newVersionNo} created.`,
        variant: "success",
      });
      setRollbackTarget(null);
      router.refresh();
    } catch (e) {
      toast({
        title: "Rollback failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRollbackPending(false);
    }
  }

  return (
    <>
      <div className="divide-y rounded-md border">
        {versions.map((v) => (
          <div key={v.id} className="space-y-1.5 px-3 py-2.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-sm font-medium">v{v.versionNo}</span>
                {isCurrentVersion(v) && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">current</Badge>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {new Date(v.createdAt).toLocaleDateString()}
              </span>
            </div>
            {v.changelog && (
              <p className="truncate text-xs text-muted-foreground" title={v.changelog}>
                {v.changelog}
              </p>
            )}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setViewVersion(v)}
              >
                View
              </Button>
              {canEdit && !isCurrentVersion(v) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setRollbackTarget(v)}
                >
                  Rollback
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {versions.length >= 2 && (
        <Button variant="outline" size="sm" className="w-full" onClick={openCompare}>
          Compare versions
        </Button>
      )}

      {/* View version dialog */}
      <Dialog open={!!viewVersion} onOpenChange={(o) => !o && setViewVersion(null)}>
        <DialogContent className="w-[min(92vw,56rem)] max-w-none">
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
          {viewVersion?.extra}
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

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="grid h-[min(88vh,54rem)] w-[min(94vw,72rem)] max-w-none grid-rows-[auto_auto_minmax(0,1fr)] gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Compare versions</DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">From</span>
              <select
                aria-label="Compare from version"
                className="rounded border bg-background px-2 py-1.5 text-xs"
                value={diffBase ?? ""}
                onChange={(e) => setDiffBase(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select —</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.versionNo}>v{v.versionNo}</option>
                ))}
              </select>
            </label>
            <span className="text-muted-foreground">→</span>
            <label className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">To</span>
              <select
                aria-label="Compare to version"
                className="rounded border bg-background px-2 py-1.5 text-xs"
                value={diffCompare ?? ""}
                onChange={(e) => setDiffCompare(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select —</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.versionNo}>v{v.versionNo}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="min-h-0 overflow-auto rounded-md border bg-muted/10">
            {diffResult ? (
              <pre className="min-w-max font-mono text-xs leading-relaxed">
                {diffResult.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === "add"
                        ? "bg-success/10 px-3 py-0.5 text-success"
                        : line.type === "remove"
                          ? "bg-destructive/10 px-3 py-0.5 text-destructive"
                          : "px-3 py-0.5 text-muted-foreground"
                    }
                  >
                    <span className="mr-2 select-none opacity-60">
                      {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                    </span>
                    {line.line || " "}
                  </div>
                ))}
              </pre>
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center p-6 text-sm text-muted-foreground">
                Select two versions to compare.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rollback confirm dialog */}
      <AlertDialog open={!!rollbackTarget} onOpenChange={(o) => !o && setRollbackTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback to v{rollbackTarget?.versionNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new version (v{nextVersionNo}) with the body from v{rollbackTarget?.versionNo}.
              No history is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRollback} disabled={rollbackPending}>
              {rollbackPending ? "Rolling back…" : "Rollback"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
