"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const TABS = ["Claude Code", "Claude Desktop", "Cursor"] as const;
type Tab = (typeof TABS)[number];

const PLACEHOLDER = "YOUR_TOKEN_HERE";

interface Props {
  endpoint: string;
  token?: string;
}

export function SetupGuide({ endpoint, token }: Props) {
  const [tab, setTab] = useState<Tab>("Claude Code");
  const [copied, setCopied] = useState<string | null>(null);

  const t = token ?? PLACEHOLDER;

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  }

  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        "agent-hub": {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${t}` },
        },
      },
    },
    null,
    2,
  );

  // Correct syntax: URL is positional arg after name, -H comes after URL
  const cliAdd =
    `claude mcp add agent-hub ${endpoint}` +
    ` \\\n  --transport http` +
    ` \\\n  -H "Authorization: Bearer ${t}"`;

  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        "agent-hub": {
          url: endpoint,
          headers: { Authorization: `Bearer ${t}` },
        },
      },
    },
    null,
    2,
  );

  // Claude Desktop's local config only accepts stdio servers (command/args/env) —
  // no "type"/"url"/"headers" fields, unlike Claude Code's .mcp.json above. mcp-remote
  // bridges stdio to this HTTP endpoint, forwarding the bearer token as a header.
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        "agent-hub": {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            endpoint,
            ...(endpoint.startsWith("http://") ? ["--allow-http"] : []),
            "--header",
            "Authorization:${AUTH_HEADER}",
          ],
          env: { AUTH_HEADER: `Bearer ${t}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        {TABS.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === name
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Claude Code */}
      {tab === "Claude Code" && (
        <div className="space-y-4">
          {/* Option A — CLI */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Option A — CLI (user-wide)
            </p>
            <p className="text-xs text-muted-foreground">
              Run once in your terminal. Registers the server for all your projects.
            </p>
            <Snippet
              id="cli"
              text={cliAdd}
              copied={copied === "cli"}
              onCopy={() => copy(cliAdd, "cli")}
            />
          </div>

          {/* Option B — .mcp.json */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Option B — .mcp.json (project-scoped)
            </p>
            <p className="text-xs text-muted-foreground">
              Create <code className="font-mono">.mcp.json</code> in your project root.
              Add to <code className="font-mono">.gitignore</code> if your token is in the file.
            </p>
            <Snippet
              id="json-cc"
              text={jsonConfig}
              copied={copied === "json-cc"}
              onCopy={() => copy(jsonConfig, "json-cc")}
            />
          </div>
        </div>
      )}

      {/* Claude Desktop */}
      {tab === "Claude Desktop" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Edit your Claude Desktop config file, then restart the app. Claude Desktop only
            supports local (stdio) MCP servers, so this uses{" "}
            <code className="font-mono">mcp-remote</code> to bridge to the HTTP endpoint above.
          </p>
          <div className="rounded-md bg-muted/60 px-3 py-2 text-[11px] font-mono space-y-1">
            <p className="text-muted-foreground not-italic">macOS</p>
            <p>~/Library/Application Support/Claude/claude_desktop_config.json</p>
            <p className="mt-1 text-muted-foreground not-italic">Windows</p>
            <p>%APPDATA%\Claude\claude_desktop_config.json</p>
          </div>
          <Snippet
            id="json-desktop"
            text={desktopConfig}
            copied={copied === "json-desktop"}
            onCopy={() => copy(desktopConfig, "json-desktop")}
          />
        </div>
      )}

      {/* Cursor */}
      {tab === "Cursor" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Edit <code className="font-mono">~/.cursor/mcp.json</code> (global) or{" "}
            <code className="font-mono">.cursor/mcp.json</code> in your project root, then restart Cursor.
          </p>
          <Snippet
            id="json-cursor"
            text={cursorConfig}
            copied={copied === "json-cursor"}
            onCopy={() => copy(cursorConfig, "json-cursor")}
          />
        </div>
      )}

      {!token && (
        <p className="text-xs text-muted-foreground italic">
          Generate a token above — the snippets will auto-fill with the real value.
        </p>
      )}
    </div>
  );
}

function Snippet({
  id,
  text,
  copied,
  onCopy,
}: {
  id: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  void id;
  return (
    <div className="rounded-md border bg-muted/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/80">
        <span className="text-[10px] text-muted-foreground select-none">shell</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-2 text-[10px] font-medium"
          onClick={onCopy}
        >
          {copied ? "✓ Copied" : "Copy"}
        </Button>
      </div>
      <pre className="px-3 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre">
        {text}
      </pre>
    </div>
  );
}
