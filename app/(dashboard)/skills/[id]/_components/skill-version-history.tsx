"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useState } from "react";

type Version = {
  id: string;
  versionNo: number;
  changelog: string | null;
  createdAt: Date;
  files: { id: string; path: string }[];
};

type Props = {
  versions: Version[];
  currentVersionId: string | null | undefined;
};

export function SkillVersionHistory({ versions, currentVersionId }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!versions.length) return null;

  return (
    <div className="divide-y rounded-md border">
      {versions.map((v) => {
        const isCurrent = v.id === currentVersionId;
        const isExpanded = expanded === v.id;

        return (
          <div key={v.id}>
            <button
              type="button"
              onClick={() => setExpanded(isExpanded ? null : v.id)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                }
                <span className="text-sm font-mono font-medium">v{v.versionNo}</span>
                {isCurrent && <Badge variant="secondary" className="text-[10px]">current</Badge>}
                {v.changelog && (
                  <span className="text-xs text-muted-foreground">{v.changelog}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(v.createdAt).toLocaleDateString()}
              </span>
            </button>

            {isExpanded && (
              <div className="border-t bg-muted/20 px-4 py-3">
                {v.files.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Bundled files ({v.files.length})
                    </p>
                    {v.files.map((f) => (
                      <div key={f.id} className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                        <FileText className="h-3 w-3 shrink-0" />
                        {f.path}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No bundled files in this version.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
