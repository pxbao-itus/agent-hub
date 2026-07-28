## Choose the right reuse method

Use **Duplicate** when you need an independently maintained copy inside Agent
Hub. Use **Export** and **Import** when moving content between spaces, backups,
or different Agent Hub instances.

Linking an artifact into a Project or Workflow is not duplication. The
linked item continues to use its original owner and current version.

## Duplicate

A duplicate starts at version 1 with a new identity and ownership. Review its
title, visibility, and destination space before publishing it.

Kind-specific data such as Skill files or Plan tasks may be copied. Version
history and usage counters are not the new copy's history.

## Export and import

Export creates a versioned bundle representation of the artifact and supported
related data. Before importing:

1. Inspect the bundle source and intended destination.
2. Preview the parsed artifact and bundled data.
3. Select a destination space you may edit.
4. Resolve name or slug conflicts.
5. Import, then review the created artifact before sharing it.

Treat exported bundles as data, not trusted executable packages. Inspect scripts
or bundled files before installing them in an agent workspace.

## Access considerations

Export only includes information you are allowed to read. Import creates a new
artifact but does not grant any additional access in the destination.

For local agent content, see [Skills](/help/skills) and
[CLI filesystem sync](/help/cli-sync).
