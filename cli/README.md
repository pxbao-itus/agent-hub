# agent-hub-cli

Tier 3 delivery for [Agent Hub](../README.md) (`plans/42-cli-filesystem-sync.md`): pulls skills and kits from a running Agent Hub instance onto the local filesystem, for tools that read `.claude/skills/`/`.claude/commands/` directly instead of going through MCP.

This package is intentionally **not** a workspace member of the app in `../` — it shares no code with it, only the MCP protocol contract (calling `pull_skill`/`pull_kit` over `/api/mcp`). It has its own `package.json` and installs independently.

## Setup

```sh
cd src/cli
pnpm install --ignore-workspace
```

`--ignore-workspace` is required because this directory sits inside the app's own pnpm project (`src/pnpm-workspace.yaml`) — without the flag, pnpm resolves against that ancestor workspace instead of this package's own `package.json`.

If `pnpm install` exits non-zero with "Ignored build scripts: esbuild" — that's just esbuild's own postinstall (platform binary optimization) being skipped by pnpm's default build-script sandboxing; the CLI works without it. Run `pnpm approve-builds --all --ignore-workspace` once if you want it built anyway.

## Usage

```sh
agent-hub login <base-url> <mcp-token>   # e.g. agent-hub login https://hub.example.com mcp_...
agent-hub pull skill <slug>              # -> .claude/skills/<slug>/SKILL.md + bundled files
agent-hub pull kit <slug>                # -> every flattened skill + .claude/commands/<slug>.md per prompt
```

Get an MCP token from **Settings → MCP Tokens** in the app. Config is saved to `~/.agent-hub/config.json`.

```sh
agent-hub sync [--force]   # re-pulls everything tracked in .agent-hub-lock.json
agent-hub status           # same diff, read-only — writes nothing
```

Conflict rule (§5, `plans/42-cli-filesystem-sync.md`): if a file was edited locally **and** the server has a newer version, `sync` leaves it alone and reports a conflict — pass `--force` to overwrite the local edit.

**Known limitation**: if a skill's bundled files change on the *server* (a file removed, or renamed), `sync` writes whatever files the new version returns but does not delete files that are no longer part of it — stale files can accumulate on disk. Not handled in M2; revisit if it turns out to matter in practice.
