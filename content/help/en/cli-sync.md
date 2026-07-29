## When to use the CLI

MCP lets an agent retrieve content on demand. Use the Agent Hub CLI when Claude
Code or Codex should discover a Skill natively from the local filesystem.

Claude is the default target and installs into `.claude/skills/`. Codex installs
into `.agents/skills/`.

## Connect and pull

Open **Integrations → CLI**. macOS Preview supports Apple Silicon and Intel:

- use the terminal command for automatic architecture detection and checksum
  verification; or
- download the matching archive manually.

Ubuntu and Windows are visible as coming soon but cannot be downloaded yet.
The macOS binary is not Apple-signed or notarized. The installer does not use
sudo, edit your shell profile, or change macOS security settings.

After installation:

1. Run `agenthub version`.
2. Create an MCP token and log in using the command shown on the CLI page.
3. Pull one Skill by slug, or use `pull skill --all` for every Skill currently
   accessible to the token.
4. Select `--target codex` when the installation is for Codex; omitted target
   means Claude.
5. Review generated files before allowing an agent to execute scripts.

The login configuration is stored under your user profile with restricted file
permissions. Keep the token private.

On a Skill detail page, **Use with CLI** opens this installation surface with
the canonical one-Skill command already prepared. Tokens are never placed in
that link.

## Track and synchronize

The workspace lock file records each remote Skill and its independent Claude
or Codex installation. Use `status` or `--dry-run` to preview differences
without writing. Use `sync` to refresh the selected target's tracked Skills.

Agent Hub is authoritative for managed Skills. Pull and sync overwrite local
changes, replace the complete managed Skill tree, and remove stale bundled
files.

A managed Skill is also removed locally when it disappears from the token's
current accessible set. Deletion, lost membership, visibility changes and
narrower token scope intentionally have the same result. Untracked local
Skills are never overwritten or removed. Do not manually edit the lock file.

Filesystem and lock-file changes use a recoverable transaction. After an
interrupted apply, the next pull or sync restores the previous complete
snapshot before continuing.

Claude Skills are invoked as `/skill-name`. Codex Skills are invoked as
`$skill-name` or selected through `/skills`.

Default installs use `agenthub-<short-slug>` as their native name. An explicit
`--as custom-name` remains exactly `custom-name`. Existing managed default names
are migrated transactionally on the next pull or sync.

Use `agenthub clean` to preview the managed Claude and Codex Skills and confirm
their removal from the current workspace. Add `--target claude|codex` to limit
the operation, `--dry-run` to preview only, or `--yes` for automation.

## Safe use

- Review bundled scripts as you would code from another repository.
- Use a scoped token.
- Run `status` or `--dry-run` before bulk synchronization after permissions or
  token scope changed.
- Store intentional customizations in Agent Hub rather than editing a managed
  local copy.
- Re-run the same versioned installer to update. Remove
  `~/.local/bin/agenthub` to uninstall the default installation.

For token setup, see [Connect an AI agent](/help/connect-agent).
