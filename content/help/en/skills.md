## When to use a Skill

A Skill describes how an AI agent should perform a reusable capability. It may
include supporting files such as templates, scripts, examples, or reference
material. Use a Prompt for a focused text instruction; use a Skill when the
agent needs a procedure and its supporting context.

## Create a Skill

1. Select the owner space and visibility.
2. Describe the capability and when an agent should use it.
3. Write the instruction body with clear inputs, steps, constraints, and
   expected outputs.
4. Add bundled files with stable relative paths when the procedure needs them.
5. Save and inspect the resulting Skill.

Do not include secrets in the body or bundled files. Prefer small, purposeful
files over a copy of an entire repository.

## Deliver the Skill

An MCP-connected agent can inspect or retrieve an accessible Skill. When the
agent must execute scripts or use files from disk, use the Agent Hub CLI to pull
the Skill into the local workspace. Claude is the default native target and
invokes the result as `/skill-name`; use `--target codex` to install the same
Skill for Codex, where it can be selected through `/skills` or invoked as
`$skill-name`. Bulk pull mirrors every Skill currently accessible to the token.

Use **Use with CLI** on a Skill detail page to open the installation surface
with the canonical pull command prepared for Claude and Codex.

Each save creates a new version of the Skill body and its bundled files. Review
the version before updating a widely used Skill, because connected agents may
retrieve the latest version immediately.

Skills can be attached to Workflow stages when a repeatable process needs the
capability.

See [CLI filesystem sync](/help/cli-sync) for local installation and
[Workflows](/help/workflows) for process organization.
