## System roles and group roles

Agent Hub has two permission layers.

**System roles**

- `user` — normal platform account.
- `superadmin` — instance-wide administration and access bypass.

**Group roles**

- `viewer` — read content available through the group.
- `editor` — read and maintain group-owned artifacts.
- `admin` — manage group access and administrative operations.

A user can have different roles in different groups. A role held on an ancestor
group may apply to descendant groups, while a lower-level role does not grant
authority over its parent.

## Manage platform users

Superadmins can create and maintain platform accounts. Before deleting or
changing a user:

1. Identify memberships, owned artifacts, projects, and assignments.
2. Transfer responsibility where necessary.
3. Revoke tokens that should no longer be used.
4. Make the smallest role change that solves the access requirement.

Avoid using superadmin as a routine working role.

## Manage group membership

Group admins can add users and choose an appropriate viewer, editor, or admin
role. Add a user at the narrowest group that covers their responsibilities.

Membership changes can affect inherited access to descendant artifacts. Direct
shares may remain even after group membership is removed, so review exceptional
shares separately.

Use the audit log for important permission changes. Use artifact sharing for
specific collaboration rather than granting a broad group role.

See [Spaces and permissions](/help/spaces-and-permissions) and
[Audit log](/help/audit-log).
