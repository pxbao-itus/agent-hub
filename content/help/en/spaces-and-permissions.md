## Who this guide is for

This guide is primarily for organization and group administrators. Regular
users can also use it to understand why an artifact is visible or editable.

## The group hierarchy

Agent Hub organizes shared ownership as:

**Organization → Department → Team**

A group role may be inherited through this hierarchy. For example, an
organization administrator can manage groups below that organization. Exact
actions still depend on the role and the resource being changed.

System roles and group roles are different:

- A **system role** applies to the whole Agent Hub instance. Superadmin is the
  privileged system role.
- A **group role** applies within an organization, department, or team.

Use the least privileged role that lets a person complete their work.

## Ownership and visibility

An artifact has one owner space. Ownership determines the group responsible for
maintaining it; it is not merely a folder.

Visibility has a separate purpose:

- **Private** is for personal artifacts.
- **Group** makes group-owned material available within its permitted group
  access.
- **Public** allows authenticated users outside the owner group to discover the
  artifact.

Public visibility does not give everyone edit permission. Mutation rights still
come from ownership, role, or another explicit permission.

## Sharing and assignment

Sharing grants a specific user access outside the normal group path. Use it for
an intentional exception, not as a replacement for correct group membership.

Assignment records responsibility for a Doc or Plan. It does **not** grant
access. Before assigning someone, make sure the person can already view the
artifact through membership, visibility, or sharing.

## Recommended administration workflow

1. Create the organization structure that matches stable responsibility
   boundaries.
2. Add users to the narrowest appropriate group.
3. Assign admin or editor roles only where they are needed.
4. Create shared artifacts in the group that should maintain them.
5. Use sharing for exceptional cross-group collaboration.
6. Review membership and the audit log when access changes unexpectedly.

Removing a membership can also remove inherited access. Check projects,
assignments, and shared work before changing a role or removing a user.
User profiles list the person's full direct membership hierarchy. A group name
is linked only when you are allowed to open that group's administration page.

See [Users and roles](/help/users-and-roles) for membership operations and
[Sharing and assignment](/help/sharing-and-assignment) for collaboration rules.
