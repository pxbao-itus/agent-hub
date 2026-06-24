import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, desc, and, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { prompts, promptVersions, promptVariables } from "@/server/db/schema";
import { getAccessibleGroups } from "@/server/auth/access";
import { renderTemplate } from "@/server/lib/template";

type Identity = { userId: string; systemRole: "user" | "superadmin" };

/** Build a per-request MCP server bound to a verified user identity. */
export function createMcpServer(identity: Identity) {
  const server = new McpServer({
    name: "prompt-hub",
    version: "0.1.0",
  });

  // ── prompts/list ────────────────────────────────────────────────────────────
  server.registerPrompt(
    "list",
    {
      description: "List all prompts accessible to the current token",
    },
    async () => {
      const rows = await getAccessiblePrompts(identity);
      return {
        description: `${rows.length} prompt(s) available`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: rows
                .map((p) => `- **${p.title}** (id: \`${p.id}\`)${p.description ? ` — ${p.description}` : ""}`)
                .join("\n") || "No prompts available.",
            },
          },
        ],
      };
    },
  );

  // ── prompts/get ─────────────────────────────────────────────────────────────
  server.registerPrompt(
    "get",
    {
      description: "Get a prompt by ID, optionally filling {{variables}}",
      argsSchema: { id: z.string().describe("Prompt ID (UUID)") },
    },
    async ({ id, ...rest }) => {
      const prompt = await getPromptForIdentity(identity, id as string);
      if (!prompt) {
        return {
          messages: [{ role: "user" as const, content: { type: "text" as const, text: `Prompt ${id} not found.` } }],
        };
      }

      const body = renderTemplate(prompt.body, rest as Record<string, string>);
      const argDocs = prompt.variables.length > 0
        ? "\n\nVariables: " + prompt.variables.map((v) => `{{${v.name}}}`).join(", ")
        : "";

      return {
        description: prompt.title,
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: body + argDocs },
          },
        ],
      };
    },
  );

  return server;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAccessiblePrompts(identity: Identity) {
  const { userId, systemRole } = identity;

  let where;
  if (systemRole !== "superadmin") {
    const groups = await getAccessibleGroups(userId, db);
    const groupConditions = groups.map((g) =>
      and(
        eq(prompts.visibility, "group"),
        eq(prompts.ownerType, g.groupType as "org" | "department" | "team"),
        eq(prompts.ownerId, g.groupId),
      ),
    );
    where = or(
      eq(prompts.visibility, "public"),
      and(eq(prompts.ownerType, "user"), eq(prompts.ownerId, userId)),
      ...(groupConditions.length > 0 ? groupConditions : [sql`false`]),
    );
  }

  return db.query.prompts.findMany({
    where,
    orderBy: desc(prompts.updatedAt),
    columns: { id: true, title: true, description: true },
  });
}

async function getPromptForIdentity(identity: Identity, promptId: string) {
  const { userId, systemRole } = identity;

  const prompt = await db.query.prompts.findFirst({
    where: eq(prompts.id, promptId),
    with: {
      versions: { orderBy: desc(promptVersions.versionNo), limit: 1 },
      variables: true,
    },
  });
  if (!prompt) return null;

  // Access check
  if (systemRole !== "superadmin" && prompt.visibility !== "public") {
    const isOwner = prompt.ownerType === "user" && prompt.ownerId === userId;
    if (!isOwner) {
      if (prompt.visibility === "group") {
        const groups = await getAccessibleGroups(userId, db);
        const allowed = groups.some(
          (g) => g.groupType === prompt.ownerType && g.groupId === prompt.ownerId,
        );
        if (!allowed) return null;
      } else {
        return null;
      }
    }
  }

  const body = prompt.versions[0]?.body ?? "";
  return { ...prompt, body, variables: prompt.variables };
}
