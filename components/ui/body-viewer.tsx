"use client";

import { useState } from "react";
import { MarkdownView } from "./markdown";
import { CopyButton } from "./copy-button";
import { cn } from "@/lib/utils";

type Mode = "rendered" | "raw";

/**
 * Artifact body viewer with a Rendered/Raw toggle. Rendered shows formatted
 * markdown; Raw shows the exact source in a monospace block. Copy always
 * copies the raw source.
 */
export function BodyViewer({
  body,
  defaultMode = "rendered",
  className,
}: {
  body: string;
  defaultMode?: Mode;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>(defaultMode);

  return (
    <div className={cn("rounded-lg border bg-muted/40", className)}>
      <div className="flex items-center justify-end gap-1.5 border-b px-2 py-1.5">
        <div className="flex rounded-md border bg-background p-0.5">
          {(["rendered", "raw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-2 py-0.5 text-xs capitalize transition-colors",
                mode === m
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <CopyButton text={body} />
      </div>

      {mode === "rendered" ? (
        <div className="px-4 py-3">
          <MarkdownView>{body}</MarkdownView>
        </div>
      ) : (
        <pre className="overflow-x-auto px-4 py-3 font-mono text-sm leading-relaxed whitespace-pre-wrap">
          {body}
        </pre>
      )}
    </div>
  );
}
