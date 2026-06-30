import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks, artifactLinks } from "@/server/db/schema";
import { getAccessibleGroups, getSharedArtifactIds, effectiveGroupRole } from "@/server/auth/access";
import { renderTemplate } from "@/server/lib/template";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { hybridSearch } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { type TokenScope, applyScopeToOwners, promptPassesScopeTags } from "./scope";
import { flattenKitMembers } from "@/server/lib/kit";
import { createPlan, addPlanLink } from "@/server/services/plan";
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

  // ── Doc setup (needed by plan tools for linked-docs trace) ──────────────

  const docRows = await getArtifactsForIdentity(identity, scope, "doc");
  const docOwnerPaths = await resolveOwnerSlugPaths(
    docRows.map((d) => ({ ownerType: d.ownerType, ownerId: d.ownerId })),
    db,
  );
  const accessibleDocIds = new Set(docRows.map((d) => d.id));

  const docBySlug = new Map<string, typeof docRows[number]>();
  for (const d of docRows) {
    const spacePath = docOwnerPaths.get(`${d.ownerType}:${d.ownerId}`) ?? "";
    const localSlug = d.slug ?? slugify(d.title);
    const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
    docBySlug.set(fullSlug, d);
    if (fullSlug !== localSlug) docBySlug.set(localSlug, d);
  }

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

  // ── Tool: search_artifacts (semantic + keyword across every kind) ──────────
  // Unified discovery: one map id → { kind, fullSlug, description } across all
  // kinds the identity can access (token scope already applied per kind above).

  const searchMeta = new Map<
    string,
    { kind: ArtifactKind; fullSlug: string; description: string | null }
  >();
  const indexForSearch = (
    list: { id: string; title: string; slug: string | null; description: string | null; ownerType: string; ownerId: string }[],
    paths: Map<string, string>,
    kind: ArtifactKind,
  ) => {
    for (const r of list) {
      const spacePath = paths.get(`${r.ownerType}:${r.ownerId}`) ?? "";
      const localSlug = r.slug ?? slugify(r.title);
      const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
      searchMeta.set(r.id, { kind, fullSlug, description: r.description });
    }
  };
  indexForSearch(rows, ownerSlugPaths, "prompt");
  indexForSearch(skillRows, skillOwnerPaths, "skill");
  indexForSearch(kitRows, kitOwnerPaths, "kit");
  indexForSearch(docRows, docOwnerPaths, "doc");
  indexForSearch(planRows, planOwnerPaths, "plan");

  const allAccessibleIds = [...searchMeta.keys()];
  const searchAccessCondition = allAccessibleIds.length
    ? inArray(artifacts.id, allAccessibleIds)
    : sql`false`;

  const usageHint = (kind: ArtifactKind, fullSlug: string): string => {
    switch (kind) {
      case "prompt": return `invoke slash command /${fullSlug}`;
      case "skill": return `get_skill('${fullSlug}')`;
      case "kit": return `get_kit('${fullSlug}')`;
      case "plan": return `get_plan('${fullSlug}')`;
      case "doc": return `get_doc('${fullSlug}')`;
    }
  };

  server.tool(
    "search_artifacts",
    "Search across everything you can access — prompts, skills, kits, plans, docs — by meaning or keywords. Returns matches with their slug and how to use each one.",
    {
      query: z.string().describe("What you're looking for — describe the task or topic"),
      kinds: z
        .array(z.enum(["prompt", "skill", "kit", "plan", "doc"]))
        .optional()
        .describe("Restrict to these kinds; omit to search all"),
      limit: z.number().int().min(1).max(20).optional().default(5),
    },
    async ({ query, kinds, limit = 5 }) => {
      const { ids } = await hybridSearch({
        query,
        accessCondition: searchAccessCondition,
        embedder: getEmbedder(),
        db,
        limit: 50,
        offset: 0,
      });

      const kindSet = kinds?.length ? new Set(kinds) : null;
      const matches: { kind: ArtifactKind; fullSlug: string; description: string | null }[] = [];
      for (const id of ids) {
        const meta = searchMeta.get(id);
        if (!meta) continue;
        if (kindSet && !kindSet.has(meta.kind)) continue;
        matches.push(meta);
        if (matches.length >= limit) break;
      }

      if (!matches.length) {
        return { content: [{ type: "text" as const, text: "No artifacts found." }] };
      }

      const lines = matches.map((m) => {
        const desc = m.description ? ` — ${m.description}` : "";
        return `- [${m.kind}] ${m.fullSlug}${desc} → ${usageHint(m.kind, m.fullSlug)}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

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

      // Linked docs — only those accessible to this token
      const links = await db.query.artifactLinks.findMany({
        where: and(eq(artifactLinks.sourceArtifactId, plan.id), eq(artifactLinks.relation, "doc")),
        orderBy: artifactLinks.position,
        with: { target: true },
      });
      const accessibleDocLinks = links.filter((l) => l.target && accessibleDocIds.has(l.target.id));
      if (accessibleDocLinks.length > 0) {
        parts.push("");
        parts.push("## Linked docs");
        for (const l of accessibleDocLinks) {
          const t = l.target!;
          const spacePath = docOwnerPaths.get(`${t.ownerType}:${t.ownerId}`) ?? "";
          const localSlug = t.slug ?? slugify(t.title);
          const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
          const desc = t.description ? `: ${t.description}` : "";
          parts.push(`- ${fullSlug}${desc}  (call get_doc to read)`);
        }
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
      };
    },
  );

  // ── Doc tools ─────────────────────────────────────────────────────────────

  server.tool(
    "list_docs",
    "List all available docs (business docs, bug descriptions, domain knowledge) with slugs and descriptions.",
    {},
    async () => {
      if (!docRows.length) {
        return { content: [{ type: "text" as const, text: "No docs available." }] };
      }
      const lines = docRows.map((d) => {
        const spacePath = docOwnerPaths.get(`${d.ownerType}:${d.ownerId}`) ?? "";
        const localSlug = d.slug ?? slugify(d.title);
        const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
        return `- ${fullSlug}${d.description ? `: ${d.description}` : ""}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_doc",
    "Get a doc's full content (business requirements, bug descriptions, domain knowledge).",
    {
      slug: z.string().describe("The doc slug (e.g. 'acme.auth-bug' or 'auth-bug')"),
    },
    async ({ slug }) => {
      const doc = docBySlug.get(slug);
      if (!doc) {
        const available = [...docBySlug.keys()].filter((_, i) => i < 10).join(", ");
        return {
          content: [{
            type: "text" as const,
            text: `Doc '${slug}' not found.${available ? ` Available docs: ${available}` : ""}`,
          }],
        };
      }

      const version = doc.versions[0];
      const parts: string[] = [];
      parts.push(`# ${doc.title}`);
      if (doc.description) parts.push(`_${doc.description}_`);
      if (doc.tags.length > 0) parts.push(`_Tags: ${doc.tags.join(", ")}_`);
      parts.push("");
      if (version?.body) parts.push(version.body);

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );

  // Write tools are only registered when the token has write=true
  if (scope.write === true) {
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
        await db.update(artifactTasks).set({ status, updatedAt: new Date() }).where(eq(artifactTasks.id, taskId));
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
          content: [{ type: "text" as const, text: `Updated. Progress: ${done}/${tasks.length} done\n\n${checklist.join("\n")}` }],
        };
      },
    );

    server.tool(
      "add_plan_task",
      "Append a new task to an existing plan. Use after create_plan or to add tasks discovered during work.",
      {
        planSlug: z.string().describe("The plan slug (e.g. 'sprint-1')"),
        content: z.string().min(1).max(2000).describe("Task description"),
      },
      async ({ planSlug, content }) => {
        const plan = planBySlug.get(planSlug);
        if (!plan) {
          return { content: [{ type: "text" as const, text: `Plan '${planSlug}' not found.` }] };
        }
        if (!accessiblePlanIds.has(plan.id)) {
          return { content: [{ type: "text" as const, text: `Access denied to plan '${planSlug}'.` }] };
        }
        const existing = await db.query.artifactTasks.findMany({
          where: eq(artifactTasks.artifactId, plan.id),
          columns: { position: true },
        });
        const maxPos = existing.reduce((m, t) => Math.max(m, t.position), -1);
        const [task] = await db.insert(artifactTasks).values({
          artifactId: plan.id,
          content,
          status: "todo",
          position: maxPos + 1,
        }).returning();
        return { content: [{ type: "text" as const, text: `Task added (id: ${task.id}): ${content}` }] };
      },
    );

    server.tool(
      "update_plan_task",
      "Update the content of an existing plan task.",
      {
        taskId: z.string().uuid().describe("The task ID (from get_plan output)"),
        content: z.string().min(1).max(2000).describe("New task description"),
      },
      async ({ taskId, content }) => {
        const task = await db.query.artifactTasks.findFirst({ where: eq(artifactTasks.id, taskId) });
        if (!task) return { content: [{ type: "text" as const, text: `Task '${taskId}' not found.` }] };
        if (!accessiblePlanIds.has(task.artifactId)) {
          return { content: [{ type: "text" as const, text: `Access denied.` }] };
        }
        await db.update(artifactTasks).set({ content, updatedAt: new Date() }).where(eq(artifactTasks.id, taskId));
        return { content: [{ type: "text" as const, text: `Task updated.` }] };
      },
    );

    server.tool(
      "delete_plan_task",
      "Remove a task from a plan.",
      {
        taskId: z.string().uuid().describe("The task ID (from get_plan output)"),
      },
      async ({ taskId }) => {
        const task = await db.query.artifactTasks.findFirst({ where: eq(artifactTasks.id, taskId) });
        if (!task) return { content: [{ type: "text" as const, text: `Task '${taskId}' not found.` }] };
        if (!accessiblePlanIds.has(task.artifactId)) {
          return { content: [{ type: "text" as const, text: `Access denied.` }] };
        }
        await db.delete(artifactTasks).where(eq(artifactTasks.id, taskId));
        return { content: [{ type: "text" as const, text: `Task deleted.` }] };
      },
    );

    server.tool(
      "create_plan",
      "Create a new plan in your personal space from a conversation with the user. Returns the plan slug to reference later.",
      {
        title: z.string().min(1).max(200).describe("Plan title"),
        body: z.string().describe("Overview / background markdown (the 'why')"),
        tasks: z.array(z.string()).default([]).describe("Initial task list (strings, status defaults to todo)"),
        description: z.string().max(500).optional().describe("Short description"),
        tags: z.array(z.string()).default([]).describe("Tags for categorisation"),
        linkedDocSlugs: z.array(z.string()).default([]).describe("Slugs of docs that prompted this plan (auto-linked)"),
        ownerType: z.enum(["user", "org", "department", "team"]).default("user").describe("Owner space. 'user' = personal (default). For group spaces the token user must have editor/admin role in that group."),
        ownerId: z.string().uuid().optional().describe("Group ID when ownerType is not 'user'. Omit for personal space."),
      },
      async ({ title, body, tasks, description, tags, linkedDocSlugs, ownerType, ownerId }) => {
        const ownerIdResolved = ownerType === "user" ? identity.userId : (ownerId ?? identity.userId);

        // For group spaces, verify the token user has sufficient role
        if (ownerType !== "user") {
          const role = await effectiveGroupRole(
            identity.userId,
            ownerType as "org" | "department" | "team",
            ownerIdResolved,
            db,
          );
          if (role !== "editor" && role !== "admin") {
            return { content: [{ type: "text" as const, text: `Permission denied: you need editor or admin role in that group space.` }] };
          }
        }

        const plan = await createPlan(
          {
            ownerType,
            ownerId: ownerIdResolved,
            title,
            body,
            description,
            tags,
            visibility: "private",
            tasks: tasks.map((c) => ({ content: c })),
            createdBy: identity.userId,
          },
          db,
        );

        // Auto-link docs
        const linked: string[] = [];
        const skipped: string[] = [];
        for (const docSlug of linkedDocSlugs) {
          const doc = docBySlug.get(docSlug);
          if (!doc || !accessibleDocIds.has(doc.id)) {
            skipped.push(docSlug);
            continue;
          }
          await addPlanLink(plan.id, doc.id, identity.userId, db);
          linked.push(docSlug);
        }

        const planSlug = plan.slug ?? slugify(title);
        let msg = `Plan created: '${planSlug}' (id: ${plan.id})`;
        if (linked.length > 0) msg += `\nLinked docs: ${linked.join(", ")}`;
        if (skipped.length > 0) msg += `\nSkipped (not found/accessible): ${skipped.join(", ")}`;
        if (tasks.length > 0) msg += `\nTasks added: ${tasks.length}`;

        return { content: [{ type: "text" as const, text: msg }] };
      },
    );

    server.tool(
      "create_doc",
      "Create a new doc (business requirement, bug description, domain knowledge) in your personal space.",
      {
        title: z.string().min(1).max(200).describe("Doc title"),
        body: z.string().min(1).describe("Full markdown content"),
        description: z.string().max(500).optional().describe("Short one-line summary"),
        tags: z.array(z.string()).default([]).describe("Tags e.g. ['bug', 'auth']"),
      },
      async ({ title, body, description, tags }) => {
        const [doc] = await db.insert(artifacts).values({
          kind: "doc",
          ownerType: "user",
          ownerId: identity.userId,
          title,
          description,
          tags,
          visibility: "private",
          createdBy: identity.userId,
        }).returning();

        const [version] = await db.insert(artifactVersions).values({
          artifactId: doc.id,
          versionNo: 1,
          body,
          changelog: "Created via MCP",
          createdBy: identity.userId,
        }).returning();

        await db.update(artifacts).set({ currentVersionId: version.id }).where(eq(artifacts.id, doc.id));

        const docSlug = doc.slug ?? slugify(title);
        return { content: [{ type: "text" as const, text: `Doc created: '${docSlug}' (id: ${doc.id})` }] };
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
