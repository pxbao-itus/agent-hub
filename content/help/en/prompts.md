## When to use a Prompt

Use a Prompt for reusable text instructions that an AI client can retrieve and
run repeatedly. A Prompt is a good fit when the main value is the wording and
the caller may provide different inputs each time.

Use a Skill instead when the agent needs a broader operating procedure or
supporting files.

## Create a reusable Prompt

1. Choose a personal or group owner space.
2. Give the Prompt a purpose-focused title and short description.
3. Add stable tags that help others find it.
4. Write the prompt body.
5. Insert variables with double braces, such as `{{language}}` or
   `{{source_code}}`, for values supplied at use time.
6. Review the detected variables and save.

Keep variables meaningful and avoid two names for the same concept. Explain
expected input format in the body when ambiguity could change the result.

## Maintain and use it

Saving an edit creates a new immutable version. Use version comparison to review
changes and rollback to restore older content as a new version.

The detail page shows the MCP identifier and usage information. A connected
agent can discover accessible Prompts without copying their body into every
client configuration.

Visibility controls discovery; ownership and role control editing. Put a Prompt
in a group space when the group should maintain it. Share it explicitly only
when someone outside the normal group access needs it.

For version behavior, see [Versions and history](/help/versions-and-history).
For agent setup, see [Connect an AI agent](/help/connect-agent).
