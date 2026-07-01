"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { AddDocLinkButton } from "./doc-picker";
import { MarkdownView } from "@/components/ui/markdown";
import { toast } from "@/hooks/use-toast";
import { FileText, ChevronDown, ChevronRight, Trash2 } from "lucide-react";

type DocLink = {
  id: string;
  position: number;
  target: {
    id: string;
    title: string;
    description: string | null;
    slug: string | null;
    body: string | null;
  } | null;
};

type Props = {
  sourceId: string;
  initialLinks: DocLink[];
  canEdit: boolean;
};

export function LinkedDocsSection({ sourceId, initialLinks, canEdit }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const utils = trpc.useUtils();

  const { data: links, refetch } = trpc.link.listForSource.useQuery(
    { sourceId },
    {
      initialData: initialLinks as never,
      refetchOnMount: false,
    },
  );

  const sortedLinks = [...(links ?? [])].sort((a, b) => a.position - b.position);
  const linkedIds = new Set(
    sortedLinks.map((l) => l.target?.id).filter((id): id is string => !!id),
  );

  const remove = trpc.link.remove.useMutation({
    onSuccess: () => {
      utils.link.listForSource.invalidate({ sourceId });
      toast({ title: "Link removed", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
  });

  const reorder = trpc.link.reorder.useMutation({
    onSuccess: () => utils.link.listForSource.invalidate({ sourceId }),
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMoveUp(idx: number) {
    if (idx === 0) return;
    const ids = sortedLinks.map((l) => l.target!.id);
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    reorder.mutate({ sourceId, orderedTargetIds: ids });
  }

  function handleMoveDown(idx: number) {
    if (idx >= sortedLinks.length - 1) return;
    const ids = sortedLinks.map((l) => l.target!.id);
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    reorder.mutate({ sourceId, orderedTargetIds: ids });
  }

  if (!canEdit && sortedLinks.length === 0) return null;

  return (
    <div className="space-y-3">
      {sortedLinks.length > 0 && (
        <div className="divide-y rounded-md border">
          {sortedLinks.map((link, idx) => {
            if (!link.target) return null;
            const isOpen = expanded.has(link.target.id);
            const hasBody = !!link.target.body;
            return (
              <div key={link.id ?? link.target.id}>
                <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors">
                  {canEdit && (
                    <div className="flex flex-col gap-0.5 shrink-0">
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
                  )}
                  {hasBody && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(link.target!.id)}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      {isOpen
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />
                      }
                    </button>
                  )}
                  {!hasBody && <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <Link href={`/docs/${link.target.id}`} className="flex-1 min-w-0 group">
                    <p className="text-sm font-medium truncate group-hover:underline">{link.target.title}</p>
                    {link.target.description && (
                      <p className="text-xs text-muted-foreground truncate">{link.target.description}</p>
                    )}
                  </Link>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">doc</Badge>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate({ sourceId, targetId: link.target!.id })}
                      disabled={remove.isPending}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove link"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {isOpen && link.target.body && (
                  <div className="border-t bg-muted/20 px-4 py-3 max-h-64 overflow-y-auto">
                    <MarkdownView>{link.target.body}</MarkdownView>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <AddDocLinkButton
          sourceId={sourceId}
          linkedIds={linkedIds}
          onAdded={() => refetch()}
        />
      )}
    </div>
  );
}
