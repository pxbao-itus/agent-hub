# agent-hub-cli

Tier 3 delivery for [Agent Hub](../README.md): pulls skills from a running
Agent Hub instance onto the local filesystem for tools that read
`.claude/skills/` directly instead of going through MCP.

Zero dependencies beyond the Go standard library — it speaks raw
JSON-RPC-over-HTTP to `/api/mcp` (calling `pull_skill`), with no MCP SDK and no
shared code with the app. It builds to a single static binary.

## Build

```sh
cd src/cli
go build -o agent-hub .
```

Requires Go 1.23+. Run `go test ./...` to run the test suite.

## Usage

```sh
agent-hub login <base-url> <mcp-token>   # e.g. agent-hub login https://hub.example.com mcp_...
agent-hub pull skill <slug>              # -> .claude/skills/<slug>/SKILL.md + bundled files
```

Get an MCP token from **Settings → MCP Tokens** in the app. Config is saved to `~/.agent-hub/config.json` (directory `0700`, file `0600`).

```sh
agent-hub sync [--force]   # re-pulls everything tracked in .agent-hub-lock.json
agent-hub status           # same diff, read-only — writes nothing
```

Conflict rule (§5, `plans/42-cli-filesystem-sync.md`): if a file was edited locally **and** the server has a newer version, `sync` leaves it alone and reports a conflict — pass `--force` to overwrite the local edit.

Stale files (a file removed or renamed in a skill's *server* version) are cleaned up automatically on `sync` — fixed in the Go rewrite; the retired TypeScript CLI left them behind.

Older lock files may still contain Kit tracking from a pre-release Agent Hub
build. The CLI warns and removes that obsolete tracking the next time it writes
the manifest. Previously generated local files are always preserved.
