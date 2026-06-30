"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FileText, Link2, Plus, Trash2, GripVertical } from "lucide-react";

type LinkedDoc = {
  id: string;
  target: {
    id: string;
    title: string;
    description: string | null;
    slug: string | null;
  } | null;
  position: number;
};

type Props = {
  sourceId: string;
  links: LinkedDoc[];
  onLinksChanged: () => void;
};

export function DocLinksManager({ sourceId, links, onLinksChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const utils = trpc.useUtils();

  const searchDocs = trpc.doc.list.useQuery(
    { query: query || undefined, limit: 10 },
    { enabled: open && query.length >= 1 },
  );

  const add = trpc.link.add.useMutation({
    onSuccess: () => {
      utils.link.listForSource.invalidate({ sourceId });
      onLinksChanged();
      toast({ title: "Doc linked", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to link", description: e.message, variant: "destructive" }),
  });

  const remove = trpc.link.remove.useMutation({
    onSuccess: () => {
      utils.link.listForSource.invalidate({ sourceId });
      onLinksChanged();
      toast({ title: "Link removed", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
  });

  const reorder = trpc.link.reorder.useMutation({
    onSuccess: () => {
      utils.link.listForSource.invalidate({ sourceId });
      onLinksChanged();
    },
  });

  const linkedIds = new Set(links.map((l) => l.target?.id).filter(Boolean));

  function handleAdd(targetId: string) {
    add.mutate({ sourceId, targetId });
  }

  function handleRemove(targetId: string) {
    remove.mutate({ sourceId, targetId });
  }

  function handleMoveUp(idx: number) {
    if (idx === 0) return;
    const ordered = [...links].sort((a, b) => a.position - b.position);
    const ids = ordered.map((l) => l.target!.id);
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    reorder.mutate({ sourceId, orderedTargetIds: ids });
  }

  function handleMoveDown(idx: number) {
    const ordered = [...links].sort((a, b) => a.position - b.position);
    if (idx >= ordered.length - 1) return;
    const ids = ordered.map((l) => l.target!.id);
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    reorder.mutate({ sourceId, orderedTargetIds: ids });
  }

  const sortedLinks = [...links].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-2">
      {sortedLinks.length > 0 && (
        <div className="divide-y rounded-md border">
          {sortedLinks.map((link, idx) => {
            if (!link.target) return null;
            return (
              <div key={link.id ?? link.target.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(idx)}
                    disabled={idx === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs leading-none"
                    aria-label="Move up"
                  >▲</button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(idx)}
                    disabled={idx === sortedLinks.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs leading-none"
                    aria-label="Move down"
                  >▼</button>
                </div>
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{link.target.title}</p>
                  {link.target.description && (
                    <p className="text-xs text-muted-foreground truncate">{link.target.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(link.target!.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  disabled={remove.isPending}
                  aria-label="Remove link"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Link doc
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link a doc</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search docs…"
              autoFocus
            />
            <div className="divide-y rounded-md border max-h-72 overflow-y-auto">
              {query.length < 1 && (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">Type to search docs</p>
              )}
              {searchDocs.isLoading && (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">Searching…</p>
              )}
              {searchDocs.data?.items.map((doc) => {
                const isLinked = linkedIds.has(doc.id);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    disabled={isLinked || add.isPending}
                    onClick={() => handleAdd(doc.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      {doc.description && (
                        <p className="text-xs text-muted-foreground truncate">{doc.description}</p>
                      )}
                    </div>
                    {isLinked && <span className="text-xs text-muted-foreground shrink-0">Linked</span>}
                  </button>
                );
              })}
              {searchDocs.data?.items.length === 0 && query.length >= 1 && (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">No docs found</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
