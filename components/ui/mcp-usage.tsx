import Link from "next/link";
import { CopyButton } from "./copy-button";
import type { ArtifactKind } from "@/server/db/schema";

function usageCommand(kind: ArtifactKind, fullSlug: string): string {
  switch (kind) {
    case "prompt": return `/mcp__agent-hub__${fullSlug}`;
    case "skill": return `get_skill('${fullSlug}')`;
    case "kit": return `get_kit('${fullSlug}')`;
    case "plan": return `get_plan('${fullSlug}')`;
    case "doc": return `get_doc('${fullSlug}')`;
  }
}

/** Shows the agent how to fetch this artifact live via MCP, with a one-click copy. */
export function McpUsage({ kind, fullSlug }: { kind: ArtifactKind; fullSlug: string }) {
  const command = usageCommand(kind, fullSlug);

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <span className="shrink-0 text-xs text-muted-foreground">Use via MCP:</span>
      <code className="flex-1 min-w-0 truncate font-mono text-xs text-foreground">{command}</code>
      <CopyButton text={command} />
      <Link
        href="/settings/tokens"
        className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
      >
        Set up access
      </Link>
    </div>
  );
}
