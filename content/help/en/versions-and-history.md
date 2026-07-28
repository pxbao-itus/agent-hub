## Immutable versions

Saving an artifact edit creates a new version instead of overwriting the
previous body. This provides a reliable record of how maintained content
changed.

The current version is the one returned by normal reads and agent retrieval.
Older versions remain available in version history.

## View and compare

Use **View** to inspect one historical body. Use **Compare versions** to select a
source and destination version and review added, removed, and unchanged lines.

Before accepting a major edit, check that:

- the intended behavior changed and unrelated content did not;
- variables, bundled files, or task guidance remain consistent;
- permission-sensitive information was not introduced.

## Roll back safely

Rollback does not delete later history or move a pointer backward silently. It
copies the selected historical content into a **new version** and makes that new
version current.

This means a rollback is auditable and can itself be compared or reversed.
Explain the reason in the changelog when the editor provides one.

## Different histories

Version history records body revisions. Other timelines have different
purposes:

- Assignment history records changes to assigner and assignees.
- Audit log records important administrative or security actions.
- Task and workflow status are operational state.

Use the history that corresponds to the question you are investigating.
