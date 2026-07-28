## System roles and group roles

Agent Hub has two permission layers.

Every account also has a unique, permanent **username** used for mentions. It
contains lowercase English letters and numbers, starts with a letter, and is
shown as `@username`. A username identifies the account even when its display
name changes. Choose it carefully when creating an account because it cannot be
edited later.

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

## View a user profile

Select a user from a member list, comment, assignment, Workflow, or another
collaboration surface to open their profile.

The profile shows:

- account identity and last successful login;
- direct Organization, Department, and Team memberships;
- inherited parent groups;
- current Doc, Plan, and Workflow responsibilities that you can access;
- actions performed by the user and events that affected them.

Membership names and direct roles act as an internal directory. A group is
linked only when you can open it. Artifact, Project, and Workflow activity is
filtered by your own access, so a profile does not grant access to private
work.

`Last login` records only the latest successful sign-in. `Never signed in`
usually means an administrator created the account but it has not been used.

## Manage platform users

Superadmins also see authentication methods and account actions on a profile.
Before deleting or changing a user:

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
