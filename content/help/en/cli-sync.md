## When to use the CLI

MCP lets an agent retrieve content on demand. Use the Agent Hub CLI when a tool
expects Skills or scripts to exist in a local filesystem such as
`.claude/skills/`.

The CLI pulls Skills from a running Agent Hub instance.

## Connect and pull

Build or install the CLI according to the project CLI README, then:

1. Log in with the Agent Hub base URL and an MCP token.
2. Pull a Skill by slug to install its instruction file and bundled files.
3. Review generated files before allowing an agent to execute scripts.

The login configuration is stored under your user profile with restricted file
permissions. Keep the token private.

## Track and synchronize

The workspace lock file records installed content and versions. Use `status` to
preview differences without writing. Use `sync` to retrieve newer tracked
versions.

If a file changed locally and the server also has a newer version, normal sync
reports a conflict and preserves the local file. Use force overwrite only after
reviewing or backing up the local change.

Files removed or renamed in a newer server Skill are cleaned up during sync.
Do not manually edit the lock file.

## Safe use

- Review bundled scripts as you would code from another repository.
- Use a scoped token.
- Run `status` before synchronization in a modified workspace.
- Commit intentional local work before a forced overwrite.

For token setup, see [Connect an AI agent](/help/connect-agent).
