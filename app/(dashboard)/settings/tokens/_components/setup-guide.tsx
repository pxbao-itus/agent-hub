"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const TABS = [
  "Claude Code",
  "Claude Desktop",
  "Cursor",
  "Codex Desktop",
  "Codex CLI",
] as const;
type Tab = (typeof TABS)[number];
type SnippetFormat = "shell" | "json" | "toml";

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

  // Codex Desktop and Codex CLI share ~/.codex/config.toml. The Desktop UI can
  // open this file from Settings → Configuration, while the CLI can manage it
  // through `codex mcp`.
  const codexDesktopConfig = [
    "[mcp_servers.agent-hub]",
    `url = ${JSON.stringify(endpoint)}`,
    `http_headers = { Authorization = ${JSON.stringify(`Bearer ${t}`)} }`,
  ].join("\n");

  const codexCliAdd = [
    `export AGENT_HUB_TOKEN=${JSON.stringify(t)}`,
    "",
    "codex mcp add agent-hub \\",
    `  --url ${JSON.stringify(endpoint)} \\`,
    "  --bearer-token-env-var AGENT_HUB_TOKEN",
    "",
    "codex mcp list",
  ].join("\n");

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="max-w-full overflow-x-auto pb-1">
        <div className="flex w-max gap-1 rounded-lg border bg-muted/40 p-1">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === name
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
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
              format="shell"
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
              format="json"
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
            format="json"
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
            format="json"
            text={cursorConfig}
            copied={copied === "json-cursor"}
            onCopy={() => copy(cursorConfig, "json-cursor")}
          />
        </div>
      )}

      {/* Codex Desktop */}
      {tab === "Codex Desktop" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Open <strong>Settings → Configuration → Open config.toml</strong>, add the
            server below, then restart Codex Desktop.
          </p>
          <div className="rounded-md bg-muted/60 px-3 py-2 text-[11px] font-mono">
            ~/.codex/config.toml
          </div>
          <Snippet
            format="toml"
            text={codexDesktopConfig}
            copied={copied === "toml-codex-desktop"}
            onCopy={() => copy(codexDesktopConfig, "toml-codex-desktop")}
          />
          <p className="text-xs text-muted-foreground">
            Verify the connection under <strong>Settings → MCP servers</strong>. This
            configuration stores the token as plain text, so keep the file private.
          </p>
        </div>
      )}

      {/* Codex CLI */}
      {tab === "Codex CLI" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Run these commands in your terminal. Codex stores the server in{" "}
            <code className="font-mono">~/.codex/config.toml</code> and reads the token
            from <code className="font-mono">AGENT_HUB_TOKEN</code>.
          </p>
          <Snippet
            format="shell"
            text={codexCliAdd}
            copied={copied === "cli-codex"}
            onCopy={() => copy(codexCliAdd, "cli-codex")}
          />
          <p className="text-xs text-muted-foreground">
            Persist the environment variable securely for future sessions. Do not commit
            the token to your shell configuration or repository. Use{" "}
            <code className="font-mono">/mcp</code> inside Codex to check the connection.
          </p>
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
  format,
  text,
  copied,
  onCopy,
}: {
  format: SnippetFormat;
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-md border bg-muted/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/80">
        <span className="text-[10px] text-muted-foreground select-none">{format}</span>
        <Button
          type="button"
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
