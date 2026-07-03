import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks, artifactLinks } from "@/server/db/schema";
import { getAccessibleGroups, getSharedArtifactIds, effectiveGroupRole } from "@/server/auth/access";
import { renderTemplate } from "@/server/lib/template";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { getCachedVersionContent } from "@/server/lib/version-cache";
import { hybridSearch } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { type TokenScope, applyScopeToOwners, promptPassesScopeTags } from "./scope";
import { flattenKitMembers } from "@/server/lib/kit";
import { createPlan, addPlanLink } from "@/server/services/plan";
import { slugify } from "@/lib/slug";
import type { ArtifactKind } from "@/server/db/schema";

type Identity = { userId: string; systemRole: "user" | "superadmin" };

/**
 * Build a per-request MCP server.
 * Each accessible prompt is registered as its own named slash command
 * so agents can invoke prompts directly without going through list/get.
 */
const ALL_KINDS: ArtifactKind[] = ["prompt", "skill", "kit", "plan", "doc"];

export async function createMcpServer(identity: Identity, scope: TokenScope = {}): Promise<McpServer> {
  const server = new McpServer({ name: "agent-hub", version: "0.1.0" });

  // One access resolution + one query for every kind, instead of 5 of each
  // (Phase 39 perf) — getAccessibleGroups/getSharedArtifactIds/findMany were
  // each re-run per kind despite returning the same thing every time.
  const byKind = await getArtifactsForIdentity(identity, scope, ALL_KINDS);
  const rows = byKind.prompt;
  const skillRows = byKind.skill;
  const kitRows = byKind.kit;
  const planRows = byKind.plan;
  const docRows = byKind.doc;

  // Resolve hierarchical slug paths for every owner across every kind in one
  // batch — same reasoning: this is a pure lookup by owner identity, not by
  // which kind asked for it, so one shared map is correct for all five.
  const ownerSlugPaths = await resolveOwnerSlugPaths(
    [...rows, ...skillRows, ...kitRows, ...planRows, ...docRows].map((r) => ({
      ownerType: r.ownerType,
      ownerId: r.ownerId,
    })),
    db,
  );
  const skillOwnerPaths = ownerSlugPaths;
  const kitOwnerPaths = ownerSlugPaths;
  const docOwnerPaths = ownerSlugPaths;
  const planOwnerPaths = ownerSlugPaths;

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
      async (args) => {
        bumpUsage(p.id);
        return {
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
        };
      },
    );
  }

  // ── Tool: get_skill ───────────────────────────────────────────────────────
  // Fetch a skill's instructions (SKILL.md body) and bundled files by slug.

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
      bumpUsage(skill.id);

      // Cached by version id (Phase 39 perf) — this used to re-fetch the
      // whole version row (body included, though only .files was actually
      // used; body already came from the batched fetch above) on every call,
      // uncached. Versions are immutable, so once a version id has been
      // resolved once, every later call for it is free.
      const content = await getCachedVersionContent(version.id, db);

      const parts: string[] = [];
      parts.push(`# ${skill.title}`);
      if (skill.description) parts.push(`_${skill.description}_`);
      parts.push("");
      parts.push(content?.body ?? version.body);

      if (content?.files.length) {
        parts.push("");
        parts.push("## Bundled files");
        for (const f of content.files) {
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

      bumpUsage(kit.id);
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

  const accessibleDocIds = new Set(docRows.map((d) => d.id));

  const docBySlug = new Map<string, typeof docRows[number]>();
  for (const d of docRows) {
    const spacePath = docOwnerPaths.get(`${d.ownerType}:${d.ownerId}`) ?? "";
    const localSlug = d.slug ?? slugify(d.title);
    const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
    docBySlug.set(fullSlug, d);
    if (fullSlug !== localSlug) docBySlug.set(localSlug, d);
  }

  // ── Resource: doc ─────────────────────────────────────────────────────────
  // Alongside the get_doc tool, expose each accessible doc as an MCP resource
  // (agenthub://doc/<fullSlug>) — clients that support the resources
  // primitive can attach docs directly (e.g. as context in a picker) instead
  // of going through a tool call. One registerResource() per doc, same
  // per-artifact-loop pattern as registerPrompt() above; access is already
  // enforced by docRows only containing what this identity can read.
  for (const d of docRows) {
    const spacePath = docOwnerPaths.get(`${d.ownerType}:${d.ownerId}`) ?? "";
    const localSlug = d.slug ?? slugify(d.title);
    const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
    const uri = `agenthub://doc/${fullSlug}`;

    server.registerResource(
      fullSlug,
      uri,
      {
        title: d.title,
        description: d.description ?? undefined,
        mimeType: "text/markdown",
      },
      async () => {
        bumpUsage(d.id);
        const version = d.versions[0];
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text: version?.body ?? "",
            },
          ],
        };
      },
    );
  }

  // ── Plan tools ────────────────────────────────────────────────────────────

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

      // One query for every plan's tasks instead of one query per plan
      // (Phase 39 perf) — counted and grouped in JS below.
      const allTasks = await db.query.artifactTasks.findMany({
        where: inArray(artifactTasks.artifactId, planRows.map((p) => p.id)),
        columns: { artifactId: true, status: true },
      });
      const counts = new Map<string, { total: number; done: number }>();
      for (const t of allTasks) {
        const c = counts.get(t.artifactId) ?? { total: 0, done: 0 };
        c.total++;
        if (t.status === "done") c.done++;
        counts.set(t.artifactId, c);
      }

      const lines = planRows.map((p) => {
        const spacePath = planOwnerPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
        const localSlug = p.slug ?? slugify(p.title);
        const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");
        const c = counts.get(p.id);
        const progress = c?.total ? ` [${c.done}/${c.total}]` : "";
        const desc = p.description ? `: ${p.description}` : "";
        return `- ${fullSlug}${desc}${progress}`;
      });

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

      bumpUsage(plan.id);
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

      bumpUsage(doc.id);
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

/**
 * Usage analytics (Phase 41) — fire-and-forget, deliberately not awaited on
 * the tool-response path (Phase 39 cut this exact request down to 8 queries;
 * blocking every content read on a write would give half of that back).
 * Called only where an agent actually retrieves content (prompt invoked,
 * get_skill/get_kit/get_plan/get_doc) — not on list/search, which only
 * surface a candidate, not a use.
 */
function bumpUsage(artifactId: string): void {
  // drizzle query builders are lazy thenables — execute() only runs once
  // something calls .then()/.catch(), so a bare `void db.update(...)` with
  // no handler attached never actually reaches the database. The .catch()
  // here isn't just error handling, it's what makes the write happen at all.
  db.update(artifacts)
    .set({ fetchCount: sql`${artifacts.fetchCount} + 1`, lastFetchedAt: new Date() })
    .where(eq(artifacts.id, artifactId))
    .catch((err) => console.error("[bumpUsage] failed", artifactId, err));
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

/**
 * Fetches every accessible artifact across all of `kinds` in one query and
 * groups the results by kind (Phase 39 perf — see the call site comment).
 * Access resolution (accessible groups + shares) is computed once here
 * regardless of how many kinds are requested.
 */
async function getArtifactsForIdentity(
  identity: Identity,
  scope: TokenScope,
  kinds: ArtifactKind[],
) {
  const { userId, systemRole } = identity;

  const accessibleGroups = await getAccessibleGroups(userId, db);
  const scopedGroups = applyScopeToOwners(scope, accessibleGroups);

  const kindFilter = inArray(artifacts.kind, kinds);

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
    columns: { id: true, kind: true, title: true, description: true, slug: true, ownerType: true, ownerId: true, tags: true },
    with: {
      variables: { columns: { name: true } },
      versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 },
    },
  });

  const filtered = scope.tags?.length ? rows.filter((r) => promptPassesScopeTags(r.tags, scope)) : rows;

  const byKind = Object.fromEntries(kinds.map((k) => [k, [] as typeof filtered])) as Record<ArtifactKind, typeof filtered>;
  for (const r of filtered) byKind[r.kind as ArtifactKind].push(r);
  return byKind;
}
