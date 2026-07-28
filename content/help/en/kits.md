## What a Kit represents

A Kit groups related artifacts into one reusable package. It is useful for a
team workflow, domain, or agent setup that requires several Prompts and Skills
together.

A Kit may contain nested Kits. Agent Hub resolves nested membership while
protecting against cycles and filtering content the current user or token cannot
access.

## Build a Kit

1. Define the purpose and intended user or agent.
2. Choose the owner space and visibility.
3. Add a concise overview describing how the members work together.
4. Search for and add existing artifacts.
5. Put members in an order that makes the package understandable.
6. Save and inspect the resolved members.

Prefer references to maintained artifacts rather than copying their content
into the Kit overview. A member continues to have its own owner, permissions,
and version history.

## Access and duplication

Seeing a Kit does not guarantee access to every referenced member. A resolved
view only includes members the current identity may read.

Duplicating a Kit creates an independently owned Kit but keeps readable members
as references. Members you cannot access may be skipped, so review the result
before sharing or using the duplicate.

Use CLI sync when a Kit needs to land Skills and files in a local agent
workspace. Use MCP when the agent only needs to discover and retrieve content.

See [Reuse, import, and export](/help/reuse-and-portability) and
[CLI filesystem sync](/help/cli-sync).
