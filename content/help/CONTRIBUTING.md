# Contributing to the user guide

The in-app guide is task-based, bilingual, and intentionally independent from
the current screen layout.

## Add or update a topic

1. Register the topic once in `registry.ts`.
2. Add matching files under `en/` and `vi/` using the same slug.
3. Keep both versions equivalent in scope and related links.
4. Update `lastReviewed` when behavior has been checked against the product.
5. Run the unit tests; missing locales, orphan files, and broken `/help/...`
   links fail validation.

## Writing style

- Explain the user's goal, required concepts, main workflow, expected result,
  and permission caveats.
- Prefer feature names over positions such as “top-right” or descriptions of
  color and icons.
- Keep `Prompt`, `Skill`, `Plan`, `Doc`, `Project`, `Workflow`, and `MCP`
  recognizable across both languages.
- Do not include real email addresses, tokens, internal infrastructure, or
  screenshots containing private data.
- Keep deployment and developer reference material in the project README or
  technical documentation instead of duplicating it here.
