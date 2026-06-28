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
import type { ArtifactKind } from "@/server/db/schema";

type Identity = { userId: string; systemRole: "user" | "superadmin" };

/**
 * Build a per-request MCP server.
 * Each accessible prompt is registered as its own named slash command
 * so agents can invoke prompts directly without going through list/get.
 */
export async function createMcpServer(identity: Identity, scope: TokenScope = {}): Promise<McpServer> {
  const server = new McpServer({ name: "prompt-hub", version: "0.1.0" });

  const rows = await getArtifactsForIdentity(identity, scope, "prompt");

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

  // ── Tool: get_skill ───────────────────────────────────────────────────────
  // Fetch a skill's instructions (SKILL.md body) and bundled files by slug.

  const skillRows = await getArtifactsForIdentity(identity, scope, "skill");
  const skillOwnerPaths = await resolveOwnerSlugPaths(
    skillRows.map((s) => ({ ownerType: s.ownerType, ownerId: s.ownerId })),
    db,
  );

  // Build slug → skill map for fast lookup
  const skillBySlug = new Map<string, typeof skillRows[number]>();
  for (const s of skillRows) {
    const spacePath = skillOwnerPaths.get(`${s.ownerType}:${s.ownerId}`) ?? "";
    const localSlug = s.slug ?? slugify(s.title);
    const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
    skillBySlug.set(fullSlug, s);
    // Also index by local slug for convenience
    if (fullSlug !== localSlug) skillBySlug.set(localSlug, s);
  }

  server.tool(
    "get_skill",
    "Get a skill's instructions and bundled files by slug. Returns the SKILL.md body and a list of attached files.",
    {
      slug: z.string().describe("The skill slug (e.g. 'acme.code-review' or 'code-review')"),
    },
    async ({ slug }) => {
      const skill = skillBySlug.get(slug);
      if (!skill) {
        const available = [...skillBySlug.keys()].slice(0, 10).join(", ");
        return {
          content: [{
            type: "text" as const,
            text: `Skill '${slug}' not found.${available ? ` Available skills: ${available}` : ""}`,
          }],
        };
      }

      const version = skill.versions[0];
      if (!version) {
        return { content: [{ type: "text" as const, text: `Skill '${slug}' has no versions.` }] };
      }

      // Fetch files for this version
      const versionWithFiles = await db.query.artifactVersions.findFirst({
        where: eq(artifactVersions.id, version.id),
        with: { files: true },
      });

      const parts: string[] = [];
      parts.push(`# ${skill.title}`);
      if (skill.description) parts.push(`_${skill.description}_`);
      parts.push("");
      parts.push(version.body);

      if (versionWithFiles?.files.length) {
        parts.push("");
        parts.push("## Bundled files");
        for (const f of versionWithFiles.files) {
          parts.push(`\n### ${f.path}`);
          parts.push("```");
          parts.push(f.content);
          parts.push("```");
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: parts.join("\n"),
        }],
      };
    },
  );

  // ── Tool: list_skills ─────────────────────────────────────────────────────
  // Let the agent discover available skills.

  server.tool(
    "list_skills",
    "List all available skills with their slugs and descriptions.",
    {},
    async () => {
      if (!skillRows.length) {
        return { content: [{ type: "text" as const, text: "No skills available." }] };
      }

      const lines = skillRows.map((s) => {
        const spacePath = skillOwnerPaths.get(`${s.ownerType}:${s.ownerId}`) ?? "";
        const localSlug = s.slug ?? slugify(s.title);
        const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
        const desc = s.description ? `: ${s.description}` : "";
        return `- ${fullSlug}${desc}`;
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
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

async function getArtifactsForIdentity(
  identity: Identity,
  scope: TokenScope,
  kind: ArtifactKind,
) {
  const { userId, systemRole } = identity;

  const accessibleGroups = await getAccessibleGroups(userId, db);
  const scopedGroups = applyScopeToOwners(scope, accessibleGroups);

  const kindFilter = eq(artifacts.kind, kind);

  let where = kindFilter;
  if (systemRole !== "superadmin") {
    const groupConditions = scopedGroups.map((g) =>
      and(
        eq(artifacts.visibility, "group"),
        eq(artifacts.ownerType, g.groupType as "org" | "department" | "team"),
        eq(artifacts.ownerId, g.groupId),
      ),
    );
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

  if (scope.tags?.length) {
    return rows.filter((r) => promptPassesScopeTags(r.tags, scope));
  }
  return rows;
}
