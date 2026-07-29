## When to use the CLI

MCP lets an agent retrieve content on demand. Use the Agent Hub CLI when Claude
Code or Codex should discover a Skill natively from the local filesystem.

Claude is the default target and installs into `.claude/skills/`. Codex installs
into `.agents/skills/`.

## Connect and pull

Build or install the CLI according to the project CLI README, then:

1. Log in with the Agent Hub base URL and an MCP token.
2. Pull one Skill by slug, or use `pull skill --all` for every Skill currently
   accessible to the token.
3. Select `--target codex` when the installation is for Codex; omitted target
   means Claude.
4. Review generated files before allowing an agent to execute scripts.

The login configuration is stored under your user profile with restricted file
permissions. Keep the token private.

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

## Safe use

- Review bundled scripts as you would code from another repository.
- Use a scoped token.
- Run `status` or `--dry-run` before bulk synchronization after permissions or
  token scope changed.
- Store intentional customizations in Agent Hub rather than editing a managed
  local copy.

For token setup, see [Connect an AI agent](/help/connect-agent).
