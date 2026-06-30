"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { DocLinksManager } from "./doc-picker";
import { FileText, ChevronDown, ChevronRight } from "lucide-react";

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

  const { data: links, refetch } = trpc.link.listForSource.useQuery(
    { sourceId },
    {
      initialData: initialLinks as never,
      refetchOnMount: false,
    },
  );

  const sortedLinks = [...(links ?? [])].sort((a, b) => a.position - b.position);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!canEdit && sortedLinks.length === 0) return null;

  return (
    <div className="space-y-3">
      {sortedLinks.length > 0 && (
        <div className="divide-y rounded-md border">
          {sortedLinks.map((link) => {
            if (!link.target) return null;
            const isOpen = expanded.has(link.target.id);
            const hasBody = !!link.target.body;
            return (
              <div key={link.id ?? link.target.id}>
                <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors">
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
                </div>
                {isOpen && link.target.body && (
                  <div className="border-t bg-muted/20 px-4 py-3">
                    <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                      {link.target.body}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <DocLinksManager
          sourceId={sourceId}
          links={sortedLinks as never}
          onLinksChanged={() => refetch()}
        />
      )}
    </div>
  );
}
