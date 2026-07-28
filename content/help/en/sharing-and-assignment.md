## Sharing and assignment solve different problems

**Sharing** grants a specific user access to an artifact outside the normal
owner-space permission path.

**Assignment** records responsibility for a Doc or Plan. It identifies who
delegated the work and who is expected to act.

Assigning someone does not grant access. The target must already be able to view
the artifact through group membership, visibility, or an explicit share.

## Share intentionally

Before sharing, consider whether the user should belong to the owner group
instead. Use a direct share for a deliberate exception or cross-group
collaboration.

Visibility and sharing determine reading access. Editing still depends on the
user's effective permission.

## Assign responsibility

A Doc or Plan has:

- one effective **assigner**;
- zero or more **assignees**.

The default assigner is derived from ownership and creation context until an
authorized editor changes it. Add multiple assignees only when responsibility
is genuinely shared.

Assignment changes appear in assignment history and may notify affected users.
Removing an assignee removes the responsibility record, not the person's
underlying access.

## Troubleshoot assignment

If a user cannot be selected:

1. Confirm the user exists and is active.
2. Check whether the user can open the artifact.
3. Add appropriate group membership or share the artifact.
4. Retry assignment.

See [Spaces and permissions](/help/spaces-and-permissions) for the access model.
