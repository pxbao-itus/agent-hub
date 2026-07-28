## Before you connect

You need the Agent Hub MCP endpoint and a token created under your own account.
The token can never exceed your current access and may be narrowed further by
space, tag, read/write capability, or expiry.

Use a separate token for each client or environment so it can be revoked
without interrupting unrelated integrations.

## Create and protect a token

1. Open MCP Tokens and create a clearly named token.
2. Select only the spaces, tags, and capabilities the agent needs.
3. Set an expiry when the integration is temporary.
4. Copy the token immediately; the full value is shown only once.
5. Store it in the client's secret or environment configuration.

Never put a token in an artifact, screenshot, repository, or shared chat.

## Configure the client

Use the setup example shown on the MCP Tokens page for your client. Clients may
use different configuration formats even when they connect to the same HTTP
endpoint, so do not reuse one client's JSON blindly.

After configuration:

1. Restart or reload the client.
2. Confirm Agent Hub tools or prompts are discoverable.
3. Retrieve one known artifact.
4. If write access is enabled, test only in a safe artifact or personal space.

## Collaborate through an agent

A read token can use `list_comments` for discussions on Docs and Plans inside
its scope. A write-enabled token can add, update, or delete comments and set
your follow preference. Put `@username` directly in a comment body to mention
someone. The tool reports unresolved or inaccessible mentions without failing
the whole comment.

Comments created by an MCP client are visibly attributed to MCP. Comment IDs do
not bypass token scope: later update or delete calls are allowed only while the
comment's artifact remains inside both your access and the token scope.

## Troubleshoot and revoke

For authentication errors, verify the endpoint, `Bearer` token header, expiry,
and token scope. If an artifact is missing, confirm both your user access and
the additional token scope.

Revoke a token immediately if it may have leaked. Revocation does not affect
your account or other tokens.

Instance deployment and network setup remain in the project README. For files
that must be installed locally, see [CLI filesystem sync](/help/cli-sync).
