# agent-hub-cli

Tier 3 delivery for [Agent Hub](../README.md): installs Skills from a running
Agent Hub instance as native local Skills for Claude Code or Codex instead of
fetching their instructions through MCP on every use.

Zero dependencies beyond the Go standard library — it speaks raw
JSON-RPC-over-HTTP to `/api/mcp` (calling `pull_skill`), with no MCP SDK and no
shared code with the app. It builds to a single static binary.

## Install on macOS

Open **Integrations → CLI** in your Agent Hub instance. The page pins an
immutable CLI release and provides:

- a terminal installer that detects Apple Silicon or Intel;
- direct archives for both macOS architectures;
- SHA-256 checksums and release notes;
- login and Skill pull commands for that instance.

The macOS build is currently an unsigned Preview. The installer verifies the
archive checksum, installs to `~/.local/bin/agent-hub`, never uses `sudo`, and
does not edit shell profiles or macOS security settings.

Verify:

```sh
agent-hub version
```

Re-run the same versioned installer to replace/update the binary. To uninstall:

```sh
rm "$HOME/.local/bin/agent-hub"
```

Ubuntu and Windows downloads are not published yet.

## Build

```sh
cd src/cli
go build -o agent-hub .
```

Requires Go 1.23+. Run `go test ./...` to run the test suite.

Release operators should follow [RELEASING.md](RELEASING.md). Creating a
`cli-vX.Y.Z` tag publishes deterministic macOS archives, checksums, a versioned
installer, and build provenance through GitHub Actions.

## Usage

```sh
agent-hub login <base-url> <mcp-token>   # e.g. agent-hub login https://hub.example.com mcp_...
agent-hub pull skill <slug>              # Claude default -> .claude/skills/<name>/
agent-hub pull skill <slug> --target codex
agent-hub pull skill <slug> --as local-name
agent-hub pull skill --all               # mirror every accessible Skill to Claude
agent-hub pull skill --all --target codex
```

Get an MCP token from **Settings → MCP Tokens** in the app. Config is saved to `~/.agent-hub/config.json` (directory `0700`, file `0600`).

```sh
agent-hub status [--target claude|codex]
agent-hub sync [--target claude|codex] [--dry-run]
```

`claude` is the default target:

| Target | Project directory | Invoke |
| --- | --- | --- |
| Claude Code | `.claude/skills/<name>/` | `/<name>` |
| Codex | `.agents/skills/<name>/` | `$<name>` or `/skills` |

The CLI renders a native `SKILL.md` frontmatter header when the Agent Hub body
does not already contain one. Existing frontmatter extensions and bundled
files are preserved. The short artifact slug is the default native name; use
`--as` to resolve a collision.

## Authoritative mirror

Agent Hub is the source of truth for every installation recorded in
`.agent-hub-lock.json`:

- repeated pull or sync overwrites local edits inside a managed Skill;
- stale bundled files are removed;
- a managed Skill absent from the token's current accessible set is removed
  locally, whether the cause is deletion, visibility, membership, sharing, or
  token scope;
- an untracked local Skill is never overwritten or deleted;
- Claude and Codex installations are tracked independently.

Filesystem changes and `.agent-hub-lock.json` are committed as one recoverable
transaction. If a CLI process stops during apply, the next mutating pull or
sync restores the last complete snapshot before continuing.

`sync` updates the selected target's already tracked collection and removes
tracked Skills that are no longer accessible. It does not add newly accessible
Skills; run `pull skill --all` to install the complete current set.

Use `--dry-run` to preview a pull or sync without writing:

```sh
agent-hub pull skill --all --target claude --dry-run
agent-hub sync --target codex --dry-run
```

Older lock files may still contain Kit tracking from a pre-release Agent Hub
build. The CLI warns and removes that obsolete tracking the next time it writes
the manifest. Existing v1 Claude Skill entries are migrated to the multi-target
manifest and native short-name layout on their next successful update.
