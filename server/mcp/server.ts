import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks } from "@/server/db/schema";
import { getAccessibleGroups, getSharedArtifactIds } from "@/server/auth/access";
import { renderTemplate } from "@/server/lib/template";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { hybridSearch, fetchPromptsByIds } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { type TokenScope, applyScopeToOwners, promptPassesScopeTags } from "./scope";
import { flattenKitMembers } from "@/server/lib/kit";
import type { ArtifactKind } from "@/server/db/schema";

type Identity = { userId: string; systemRole: "user" | "superadmin" };

/**
 * Build a per-request MCP server.
 * Each accessible prompt is registered as its own named slash command
 * so agents can invoke prompts directly without going through list/get.
 */
export async function createMcpServer(identity: Identity, scope: TokenScope = {}): Promise<McpServer> {
  const server = new McpServer({ name: "agent-hub", version: "0.1.0" });

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

  // ── Kit tools ─────────────────────────────────────────────────────────────

  const kitRows = await getArtifactsForIdentity(identity, scope, "kit");
  const kitOwnerPaths = await resolveOwnerSlugPaths(
    kitRows.map((k) => ({ ownerType: k.ownerType, ownerId: k.ownerId })),
    db,
  );

  const kitBySlug = new Map<string, typeof kitRows[number]>();
  for (const k of kitRows) {
    const spacePath = kitOwnerPaths.get(`${k.ownerType}:${k.ownerId}`) ?? "";
    const localSlug = k.slug ?? slugify(k.title);
    const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
    kitBySlug.set(fullSlug, k);
    if (fullSlug !== localSlug) kitBySlug.set(localSlug, k);
  }

  // Accessible artifact id set for access-filtering during flatten
  const accessibleArtifactIds = new Set([
    ...rows.map((r) => r.id),
    ...skillRows.map((r) => r.id),
    ...kitRows.map((r) => r.id),
  ]);

  server.tool(
    "list_kits",
    "List all available kits with their slugs and descriptions.",
    {},
    async () => {
      if (!kitRows.length) {
        return { content: [{ type: "text" as const, text: "No kits available." }] };
      }

      const lines = kitRows.map((k) => {
        const spacePath = kitOwnerPaths.get(`${k.ownerType}:${k.ownerId}`) ?? "";
        const localSlug = k.slug ?? slugify(k.title);
        const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
        const desc = k.description ? `: ${k.description}` : "";
        return `- ${fullSlug}${desc}`;
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  server.tool(
    "get_kit",
    "Get a kit's overview and the list of member slugs (prompts + skills) you should fetch next. Kit members are flattened recursively.",
    {
      slug: z.string().describe("The kit slug (e.g. 'acme.starter-kit' or 'starter-kit')"),
    },
    async ({ slug }) => {
      const kit = kitBySlug.get(slug);
      if (!kit) {
        const available = [...kitBySlug.keys()].filter((_, i) => i < 10).join(", ");
        return {
          content: [{
            type: "text" as const,
            text: `Kit '${slug}' not found.${available ? ` Available kits: ${available}` : ""}`,
          }],
        };
      }

      const version = kit.versions[0];
      const overviewBody = version?.body ?? "";

      const { prompts: flatPrompts, skills: flatSkills } = await flattenKitMembers(
        kit.id,
        db,
        accessibleArtifactIds,
      );

      // Build slug lookup maps for prompts and skills
      const promptSlugMap = new Map(rows.map((r) => {
        const spacePath = ownerSlugPaths.get(`${r.ownerType}:${r.ownerId}`) ?? "";
        const localSlug = r.slug ?? slugify(r.title);
        return [r.id, [spacePath, localSlug].filter(Boolean).join(".")];
      }));
      const skillSlugMap = new Map(skillRows.map((r) => {
        const spacePath = skillOwnerPaths.get(`${r.ownerType}:${r.ownerId}`) ?? "";
        const localSlug = r.slug ?? slugify(r.title);
        return [r.id, [spacePath, localSlug].filter(Boolean).join(".")];
      }));

      const parts: string[] = [];
      parts.push(`# ${kit.title}`);
      if (kit.description) parts.push(`_${kit.description}_`);
      parts.push("");
      if (overviewBody) {
        parts.push(overviewBody);
        parts.push("");
      }

      if (flatPrompts.length > 0) {
        parts.push("## Prompts — call each as a slash command");
        for (const p of flatPrompts) {
          const s = promptSlugMap.get(p.id) ?? (p.slug ?? slugify(p.title));
          const desc = p.description ? ` — ${p.description}` : "";
          parts.push(`- \`/${s}\`${desc}`);
        }
        parts.push("");
      }

      if (flatSkills.length > 0) {
        parts.push("## Skills — call get_skill for each");
        for (const s of flatSkills) {
          const sl = skillSlugMap.get(s.id) ?? (s.slug ?? slugify(s.title));
          const desc = s.description ? ` — ${s.description}` : "";
          parts.push(`- get_skill('${sl}')${desc}`);
        }
        parts.push("");
      }

      if (flatPrompts.length === 0 && flatSkills.length === 0) {
        parts.push("_This kit has no accessible members._");
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
      };
    },
  );

  // ── Plan tools ────────────────────────────────────────────────────────────

  const planRows = await getArtifactsForIdentity(identity, scope, "plan");
  const planOwnerPaths = await resolveOwnerSlugPaths(
    planRows.map((p) => ({ ownerType: p.ownerType, ownerId: p.ownerId })),
    db,
  );

  const planBySlug = new Map<string, typeof planRows[number]>();
  for (const p of planRows) {
    const spacePath = planOwnerPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
    const localSlug = p.slug ?? slugify(p.title);
    const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
    planBySlug.set(fullSlug, p);
    if (fullSlug !== localSlug) planBySlug.set(localSlug, p);
  }

  server.tool(
    "list_plans",
    "List all available plans with their slugs, descriptions and progress.",
    {},
    async () => {
      if (!planRows.length) {
        return { content: [{ type: "text" as const, text: "No plans available." }] };
      }

      const lines = await Promise.all(
        planRows.map(async (p) => {
          const spacePath = planOwnerPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
          const localSlug = p.slug ?? slugify(p.title);
          const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
          const tasks = await db.query.artifactTasks.findMany({
            where: eq(artifactTasks.artifactId, p.id),
            columns: { status: true },
          });
          const done = tasks.filter((t) => t.status === "done").length;
          const progress = tasks.length ? ` [${done}/${tasks.length}]` : "";
          const desc = p.description ? `: ${p.description}` : "";
          return `- ${fullSlug}${desc}${progress}`;
        }),
      );

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_plan",
    "Get a plan's overview and task checklist (with task IDs for update_task_status).",
    {
      slug: z.string().describe("The plan slug (e.g. 'acme.sprint-1' or 'sprint-1')"),
    },
    async ({ slug }) => {
      const plan = planBySlug.get(slug);
      if (!plan) {
        const available = [...planBySlug.keys()].filter((_, i) => i < 10).join(", ");
        return {
          content: [{
            type: "text" as const,
            text: `Plan '${slug}' not found.${available ? ` Available plans: ${available}` : ""}`,
          }],
        };
      }

      const version = plan.versions[0];
      const tasks = await db.query.artifactTasks.findMany({
        where: eq(artifactTasks.artifactId, plan.id),
        orderBy: artifactTasks.position,
      });

      const done = tasks.filter((t) => t.status === "done").length;

      const parts: string[] = [];
      parts.push(`# ${plan.title}`);
      if (plan.description) parts.push(`_${plan.description}_`);
      parts.push("");
      parts.push(`**Progress: ${done}/${tasks.length} done**`);
      parts.push("");

      if (version?.body) {
        parts.push(version.body);
        parts.push("");
      }

      if (tasks.length > 0) {
        parts.push("## Tasks");
        for (const t of tasks) {
          const check = t.status === "done" ? "[x]" : t.status === "doing" ? "[~]" : "[ ]";
          parts.push(`- ${check} (id: ${t.id}) ${t.content}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
      };
    },
  );

  // update_task_status is only registered when the token has write=true
  if (scope.write === true) {
    // Build accessible plan artifact ids for write gate
    const accessiblePlanIds = new Set(planRows.map((p) => p.id));

    server.tool(
      "update_task_status",
      "Update the status of a plan task. Only available with a write-enabled token.",
      {
        taskId: z.string().uuid().describe("The task ID (from get_plan output)"),
        status: z.enum(["todo", "doing", "done"]).describe("New status"),
      },
      async ({ taskId, status }) => {
        const task = await db.query.artifactTasks.findFirst({
          where: eq(artifactTasks.id, taskId),
        });
        if (!task) {
          return { content: [{ type: "text" as const, text: `Task '${taskId}' not found.` }] };
        }

        if (!accessiblePlanIds.has(task.artifactId)) {
          return {
            content: [{ type: "text" as const, text: `Access denied: task '${taskId}' is not in an accessible plan.` }],
          };
        }

        await db
          .update(artifactTasks)
          .set({ status, updatedAt: new Date() })
          .where(eq(artifactTasks.id, taskId));

        // Return updated checklist
        const tasks = await db.query.artifactTasks.findMany({
          where: eq(artifactTasks.artifactId, task.artifactId),
          orderBy: artifactTasks.position,
        });
        const done = tasks.filter((t) => t.status === "done").length;
        const checklist = tasks.map((t) => {
          const check = t.status === "done" ? "[x]" : t.status === "doing" ? "[~]" : "[ ]";
          return `- ${check} (id: ${t.id}) ${t.content}`;
        });

        return {
          content: [{
            type: "text" as const,
            text: `Updated. Progress: ${done}/${tasks.length} done\n\n${checklist.join("\n")}`,
          }],
        };
      },
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
    const sharedMap = await getSharedArtifactIds(userId, db);
    const sharedIds = [...sharedMap.keys()];

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
      ...(sharedIds.length > 0 ? [inArray(artifacts.id, sharedIds)] : []),
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
