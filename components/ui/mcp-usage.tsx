import Link from "next/link";
import { CopyButton } from "./copy-button";
import type { ArtifactKind } from "@/server/db/schema";
import { cn } from "@/lib/utils";

function usageCommand(kind: ArtifactKind, fullSlug: string): string {
  switch (kind) {
    case "prompt": return `/mcp__agent-hub__${fullSlug}`;
    case "skill": return `get_skill('${fullSlug}')`;
    case "plan": return `get_plan('${fullSlug}')`;
    case "doc": return `get_doc('${fullSlug}')`;
  }
}

/** Shows the agent how to fetch this artifact live via MCP, with a one-click copy. */
export function McpUsage({
  kind,
  fullSlug,
  variant = "default",
}: {
  kind: ArtifactKind;
  fullSlug: string;
  variant?: "default" | "compact";
}) {
  const command = usageCommand(kind, fullSlug);
  const compact = variant === "compact";

  return (
    <div className={cn(
      "rounded-md border bg-muted/40 px-3 py-2",
      compact ? "space-y-2" : "flex flex-col gap-2 sm:flex-row sm:items-center",
    )}>
      <div className={cn("min-w-0 flex-1", compact ? "space-y-1.5" : "flex items-center gap-2")}>
        <span className="block shrink-0 text-xs text-muted-foreground">Use via MCP:</span>
        <code className={cn(
          "block min-w-0 font-mono text-xs text-foreground",
          compact ? "break-all" : "flex-1 truncate",
        )}>{command}</code>
      </div>
      <div className={cn("flex shrink-0 items-center gap-2", compact && "justify-between")}>
        <CopyButton text={command} />
        <Link
          href="/settings/tokens"
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Set up access
        </Link>
      </div>
    </div>
  );
}
