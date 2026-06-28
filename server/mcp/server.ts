import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { getAccessibleGroups } from "@/server/auth/access";
import { renderTemplate } from "@/server/lib/template";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { hybridSearch, fetchPromptsByIds } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { type TokenScope, applyScopeToOwners, promptPassesScopeTags } from "./scope";

type Identity = { userId: string; systemRole: "user" | "superadmin" };

/**
 * Build a per-request MCP server.
 * Each accessible prompt is registered as its own named slash command
 * so agents can invoke prompts directly without going through list/get.
 */
export async function createMcpServer(identity: Identity, scope: TokenScope = {}): Promise<McpServer> {
  const server = new McpServer({ name: "prompt-hub", version: "0.1.0" });

  const rows = await getPromptsForIdentity(identity, scope);

  // Resolve hierarchical slug paths for all owner entities in one batch
  const ownerSlugPaths = await resolveOwnerSlugPaths(
    rows.map((p) => ({ ownerType: p.ownerType, ownerId: p.ownerId })),
    db,
  );

  const seen = new Set<string>();

  // Pre-seed `seen` with all explicit slugs (across all spaces) to prevent collisions
  for (const p of rows) {
    if (p.slug) {
      const spacePath = ownerSlugPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
      const full = [spacePath, p.slug].filter(Boolean).join(".");
      seen.add(full);
    }
  }

  for (const p of rows) {
    const body = p.versions[0]?.body ?? "";
    if (!body) continue;

    const spacePath = ownerSlugPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
    const localSlug = p.slug ?? uniqueSlug(p.title, p.id, seen);
    const slug = [spacePath, localSlug].filter(Boolean).join(".");

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

  // ── Tool: search_prompts ───────────────────────────────────────────────────
  // Useful when the agent doesn't know the slug yet and wants to discover prompts.

  // Reuse the already-loaded accessible prompt IDs as the access filter for search.
  const accessibleIds = rows.map((r) => r.id);
  const accessCondition = accessibleIds.length ? inArray(artifacts.id, accessibleIds) : sql`false`;

  server.tool(
    "search_prompts",
    "Search for prompts by meaning or keywords. Returns matching prompt slugs you can call directly.",
    {
      query: z.string().describe("What you're looking for — describe the task or topic"),
      limit: z.number().int().min(1).max(20).optional().default(5),
    },
    async ({ query, limit = 5 }) => {
      const { ids } = await hybridSearch({
        query,
        accessCondition,
        embedder: getEmbedder(),
        db,
        limit,
        offset: 0,
      });
      const results = await fetchPromptsByIds(ids, db);

      if (!results.length) {
        return { content: [{ type: "text" as const, text: "No prompts found." }] };
      }

      const lines = results.map((p) => {
        const spacePath = ownerSlugPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
        const localSlug = p.slug ?? slugify(p.title);
        const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
        const desc = p.description ? `: ${p.description}` : "";
        return `- ${fullSlug}${desc}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: lines.join("\n"),
        }],
      };
    },
  );

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

async function getPromptsForIdentity(identity: Identity, scope: TokenScope) {
  const { userId, systemRole } = identity;

  let accessibleGroups = await getAccessibleGroups(userId, db);

  // Apply scope space restriction: intersect accessible groups with scope.spaces
  const scopedGroups = applyScopeToOwners(scope, accessibleGroups);

  // Forward-compat: only prompt-kind artifacts are served over MCP for now.
  // Skill/kit get their own delivery in later phases.
  const kindFilter = eq(artifacts.kind, "prompt");

  let where = kindFilter;
  if (systemRole !== "superadmin") {
    const groupConditions = scopedGroups.map((g) =>
      and(
        eq(artifacts.visibility, "group"),
        eq(artifacts.ownerType, g.groupType as "org" | "department" | "team"),
        eq(artifacts.ownerId, g.groupId),
      ),
    );
    // When scope restricts spaces, exclude personal prompts if no personal space in scope
    const includePersonal = !scope.spaces?.length;
    const accessClause = or(
      eq(artifacts.visibility, "public"),
      ...(includePersonal ? [and(eq(artifacts.ownerType, "user"), eq(artifacts.ownerId, userId))] : []),
      ...(groupConditions.length > 0 ? groupConditions : [sql`false`]),
    );
    where = and(kindFilter, accessClause)!;
  }

  const rows = await db.query.artifacts.findMany({
    where,
    orderBy: desc(artifacts.updatedAt),
    columns: { id: true, title: true, description: true, slug: true, ownerType: true, ownerId: true, tags: true },
    with: {
      variables: { columns: { name: true } },
      versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 },
    },
  });

  // Apply scope tag restriction (in-memory, tags are arrays)
  if (scope.tags?.length) {
    return rows.filter((r) => promptPassesScopeTags(r.tags, scope));
  }
  return rows;
}
