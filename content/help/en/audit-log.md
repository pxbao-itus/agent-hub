## What the audit log records

The audit log is a superadmin view of security-relevant events. It helps answer
who performed an important action, what kind of target changed, and when it
happened.

Examples include:

- deleting artifacts or administrative resources;
- sharing and permission changes;
- membership changes;
- token creation or revocation;
- project membership and assignment changes where recorded.

The log is ordered by event time and shows an actor, action name, target, and
available context.

## Investigate an event

1. Identify the time range and action category.
2. Check the actor, including whether the account has since been deleted.
3. Read the target type and metadata summary.
4. Open the related resource when it still exists.
5. Compare with membership, sharing, version, or assignment history as needed.

An audit event indicates that an action occurred; it does not always contain the
complete before-and-after content.

## Know the boundaries

The audit log is not a record of every normal content edit. Artifact body edits
belong in version history. Assigner and assignee changes have a dedicated
assignment timeline. Task and Workflow status are operational state.

Access to the audit log is restricted to superadmins because it can expose
cross-organization security context. Do not copy audit metadata into public
artifacts.

See [Versions and history](/help/versions-and-history) and
[Users and roles](/help/users-and-roles).
