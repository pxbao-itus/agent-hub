import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, desc, and, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { prompts, promptVersions } from "@/server/db/schema";
import { getAccessibleGroups } from "@/server/auth/access";
import { renderTemplate } from "@/server/lib/template";

type Identity = { userId: string; systemRole: "user" | "superadmin" };

/**
 * Build a per-request MCP server.
 * Each accessible prompt is registered as its own named slash command
 * so agents can invoke prompts directly without going through list/get.
 */
export async function createMcpServer(identity: Identity): Promise<McpServer> {
  const server = new McpServer({ name: "prompt-hub", version: "0.1.0" });

  const rows = await getPromptsForIdentity(identity);
  const seen = new Set<string>();

  // Pre-seed `seen` with explicit slugs so auto-gen never collides with them
  for (const p of rows) {
    if (p.slug) seen.add(p.slug);
  }

  for (const p of rows) {
    const body = p.versions[0]?.body ?? "";
    if (!body) continue;

    const slug = p.slug ?? uniqueSlug(p.title, p.id, seen);

    // Build argsSchema from template variables (all optional — unset vars keep {{placeholder}})
    const argsShape: Record<string, z.ZodOptional<z.ZodString>> = {};
    for (const v of p.variables) {
      argsShape[v.name] = z.string().describe(v.name).optional();
    }

    server.registerPrompt(
      slug,
      { description: p.description ?? p.title, argsSchema: argsShape },
      async (args) => ({
        description: p.title,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: renderTemplate(body, args as Record<string, string>),
            },
          },
        ],
      }),
    );
  }

  return server;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "") || "prompt"
  );
}

function uniqueSlug(title: string, id: string, seen: Set<string>): string {
  const base = slugify(title);
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  const withId = `${base}-${id.slice(0, 6)}`;
  seen.add(withId);
  return withId;
}

async function getPromptsForIdentity(identity: Identity) {
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
    columns: { id: true, title: true, description: true, slug: true },
    with: {
      variables: { columns: { name: true } },
      versions: { orderBy: desc(promptVersions.versionNo), limit: 1 },
    },
  });
}
