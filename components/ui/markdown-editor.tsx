"use client";

import { useState } from "react";
import { Textarea } from "./textarea";
import { MarkdownView } from "./markdown";
import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

/** Markdown textarea with a Write/Preview toggle. */
export function MarkdownEditor({ id, value, onChange, rows = 8, required, placeholder, className }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");

  return (
    <div className="space-y-2">
      <div className="flex w-fit rounded-md border bg-background p-0.5">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-2.5 py-0.5 text-xs capitalize transition-colors",
              tab === t
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "write" ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          required={required}
          placeholder={placeholder}
          className={cn("resize-y font-mono text-sm", className)}
        />
      ) : (
        <div className="min-h-32 rounded-md border bg-muted/20 px-3 py-2">
          {value.trim() ? (
            <MarkdownView>{value}</MarkdownView>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      )}
    </div>
  );
}
