import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, asc, desc, and, or, sql, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks, artifactLinks, workflows, workflowStages, workflowStageArtifacts, projects, projectArtifacts } from "@/server/db/schema";
import { getAccessibleGroups, getSharedArtifactIds, effectiveGroupRole } from "@/server/auth/access";
import { canViewWorkflow, canManageWorkflow, attachWorkflowProgress } from "@/server/lib/workflow-access";
import { canViewProject, attachProjectCounts } from "@/server/lib/project-access";
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

const SERVER_INSTRUCTIONS =
  "Agent Hub is a shared library of prompts, skills, kits, plans, docs, and workflows. " +
  "Prompts are exposed as native prompts/slash-commands; everything else is fetched with get_skill/get_kit/get_plan/get_doc/get_workflow. " +
  "Start with the `overview` tool to see what's here before searching blind.";

export async function createMcpServer(identity: Identity, scope: TokenScope = {}): Promise<McpServer> {
  const server = new McpServer(
    { name: "agent-hub", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

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

  // ── Tool: pull_skill ──────────────────────────────────────────────────────
  // Machine-readable counterpart to get_skill, for the CLI (Phase 42 M2,
  // plans/42-cli-filesystem-sync.md) — tRPC's artifact.export bundle isn't
  // reachable with an MCP bearer token (session-cookie-only), so this is a
  // dedicated JSON surface reusing the same bundle shape (Phase 40).
  // get_skill's markdown output is unchanged; this is an additive tool.

  server.tool(
    "pull_skill",
    "Machine-readable skill bundle (JSON) for CLI/filesystem sync — not for agent/LLM consumption, use get_skill for that.",
    {
      slug: z.string().describe("The skill slug (e.g. 'acme.code-review' or 'code-review')"),
    },
    async ({ slug }) => {
      const skill = skillBySlug.get(slug);
      if (!skill) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Skill '${slug}' not found.` }) }] };
      }
      const version = skill.versions[0];
      if (!version) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Skill '${slug}' has no versions.` }) }] };
      }
      bumpUsage(skill.id);
      const content = await getCachedVersionContent(version.id, db);

      const spacePath = skillOwnerPaths.get(`${skill.ownerType}:${skill.ownerId}`) ?? "";
      const localSlug = skill.slug ?? slugify(skill.title);
      const fullSlug = [spacePath, localSlug].filter(Boolean).join(".");

      const bundle = {
        schemaVersion: 1 as const,
        kind: "skill" as const,
        slug: fullSlug,
        title: skill.title,
        description: skill.description ?? null,
        body: content?.body ?? version.body,
        files: content?.files ?? [],
        versionNo: version.versionNo,
        updatedAt: version.createdAt.toISOString(),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(bundle) }] };
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
    "List all available toolkits — packaged sets of prompts/skills you can equip for a task or workflow stage — with their slugs and descriptions.",
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
    "Get a toolkit's overview and the list of member slugs (prompts + skills) you should fetch next — a toolkit equips you with a packaged, reusable capability for a task or workflow stage. Members are flattened recursively.",
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

  // ── Tool: pull_kit ────────────────────────────────────────────────────────
  // Machine-readable counterpart to get_kit, for the CLI (Phase 42 M2). The
  // flatten happens server-side (flattenKitMembers already handles recursion,
  // dedup, and cycles) so the CLI receives one fully-resolved payload instead
  // of re-implementing the kit graph walk itself.

  server.tool(
    "pull_kit",
    "Machine-readable toolkit bundle (JSON): the toolkit itself plus every recursively-flattened member skill/prompt, fully resolved. For CLI/filesystem sync — not for agent/LLM consumption, use get_kit for that.",
    {
      slug: z.string().describe("The kit slug (e.g. 'acme.starter-kit' or 'starter-kit')"),
    },
    async ({ slug }) => {
      const kit = kitBySlug.get(slug);
      if (!kit) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Kit '${slug}' not found.` }) }] };
      }
      bumpUsage(kit.id);
      const version = kit.versions[0];

      const { prompts: flatPrompts, skills: flatSkills } = await flattenKitMembers(
        kit.id,
        db,
        accessibleArtifactIds,
      );

      const promptById = new Map(rows.map((r) => [r.id, r]));
      const skillById = new Map(skillRows.map((r) => [r.id, r]));

      const prompts = flatPrompts.flatMap((p) => {
        const full = promptById.get(p.id);
        const v = full?.versions[0];
        if (!full || !v) return [];
        const spacePath = ownerSlugPaths.get(`${full.ownerType}:${full.ownerId}`) ?? "";
        const localSlug = full.slug ?? slugify(full.title);
        return [{
          slug: [spacePath, localSlug].filter(Boolean).join("."),
          title: full.title,
          description: full.description ?? null,
          body: v.body,
          versionNo: v.versionNo,
          updatedAt: v.createdAt.toISOString(),
        }];
      });

      const skills = [];
      for (const s of flatSkills) {
        const full = skillById.get(s.id);
        const v = full?.versions[0];
        if (!full || !v) continue;
        const content = await getCachedVersionContent(v.id, db);
        const spacePath = skillOwnerPaths.get(`${full.ownerType}:${full.ownerId}`) ?? "";
        const localSlug = full.slug ?? slugify(full.title);
        skills.push({
          slug: [spacePath, localSlug].filter(Boolean).join("."),
          title: full.title,
          description: full.description ?? null,
          body: content?.body ?? v.body,
          files: content?.files ?? [],
          versionNo: v.versionNo,
          updatedAt: v.createdAt.toISOString(),
        });
      }

      const kitSpacePath = kitOwnerPaths.get(`${kit.ownerType}:${kit.ownerId}`) ?? "";
      const kitLocalSlug = kit.slug ?? slugify(kit.title);

      const bundle = {
        schemaVersion: 1 as const,
        kind: "kit" as const,
        slug: [kitSpacePath, kitLocalSlug].filter(Boolean).join("."),
        title: kit.title,
        description: kit.description ?? null,
        body: version?.body ?? "",
        versionNo: version?.versionNo ?? 0,
        updatedAt: version?.createdAt.toISOString() ?? null,
        prompts,
        skills,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(bundle) }] };
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
    { kind: ArtifactKind; fullSlug: string; title: string; description: string | null }
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
      searchMeta.set(r.id, { kind, fullSlug, title: r.title, description: r.description });
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

  // ── Workflow tools ───────────────────────────────────────────────────────
  // Workflows aren't artifacts (no kind/visibility/slug) so they sit outside
  // getArtifactsForIdentity's batch — visibility follows the plain user cone
  // (D-016), same as the workflow tRPC router. Stage artifact references are
  // resolved through `searchMeta`, which was built from the already
  // scope-filtered per-kind rows above: an attachment whose id isn't in that
  // map is invisible to this identity/token and is silently dropped, so
  // get_workflow never leaks a reference to something get_doc/get_skill/etc
  // would then refuse to open.

  const identityUser = { userId: identity.userId, systemRole: identity.systemRole };

  async function listAccessibleWorkflows() {
    if (identity.systemRole === "superadmin") {
      return db.query.workflows.findMany({ orderBy: desc(workflows.updatedAt) });
    }
    const groups = await getAccessibleGroups(identity.userId, db);
    if (!groups.length) return [];
    const where = or(
      ...groups.map((g) => and(eq(workflows.ownerGroupType, g.groupType), eq(workflows.ownerGroupId, g.groupId))),
    );
    return db.query.workflows.findMany({ where, orderBy: desc(workflows.updatedAt) });
  }

  server.tool(
    "list_workflows",
    "List processes/workflows you can see — ordered stages that tie docs, plans, and toolkits together across a lifecycle (spec, build, review, ...). Shows progress and which stage is active.",
    {},
    async () => {
      const rows = await listAccessibleWorkflows();
      if (!rows.length) {
        return { content: [{ type: "text" as const, text: "No workflows available." }] };
      }

      const [withProgress, allStages, projectRows] = await Promise.all([
        attachWorkflowProgress(rows, db),
        db.query.workflowStages.findMany({
          where: inArray(workflowStages.workflowId, rows.map((w) => w.id)),
          orderBy: asc(workflowStages.position),
        }),
        db.query.projects.findMany({
          where: inArray(projects.id, rows.flatMap((w) => (w.projectId ? [w.projectId] : []))),
          columns: { id: true, name: true },
        }),
      ]);
      const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]));
      const doingStageByWorkflow = new Map<string, string>();
      for (const s of allStages) {
        if (s.status === "doing" && !doingStageByWorkflow.has(s.workflowId)) {
          doingStageByWorkflow.set(s.workflowId, s.name);
        }
      }

      const lines = withProgress.map((w) => {
        const project = w.projectId ? projectNameById.get(w.projectId) : undefined;
        const bits = [`${w.doneCount}/${w.stageCount} stages done`];
        const doing = doingStageByWorkflow.get(w.id);
        if (doing) bits.push(`now: ${doing}`);
        if (project) bits.push(`project: ${project}`);
        const desc = w.description ? ` — ${w.description}` : "";
        return `- ${w.name}${desc} (${bits.join(", ")}) (id: ${w.id})`;
      });

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_workflow",
    "Get a workflow's full stage structure — ordered stages with status, and each stage's attached artifacts as references (kind + slug + title). Call get_doc/get_skill/get_kit/get_plan for the actual content of a reference.",
    {
      id: z.string().uuid().describe("The workflow id (from list_workflows output)"),
    },
    async ({ id }) => {
      const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
      if (!workflow) {
        return { content: [{ type: "text" as const, text: `Workflow '${id}' not found.` }] };
      }
      const viewable = await canViewWorkflow(identityUser, workflow, db);
      if (!viewable) {
        return { content: [{ type: "text" as const, text: `Access denied: workflow '${id}' is not accessible.` }] };
      }

      const [stageRows, stageArtifactRows, project] = await Promise.all([
        db.query.workflowStages.findMany({
          where: eq(workflowStages.workflowId, workflow.id),
          orderBy: asc(workflowStages.position),
        }),
        db
          .select({ stageId: workflowStageArtifacts.stageId, artifactId: workflowStageArtifacts.artifactId })
          .from(workflowStageArtifacts)
          .innerJoin(workflowStages, eq(workflowStageArtifacts.stageId, workflowStages.id))
          .where(eq(workflowStages.workflowId, workflow.id))
          .orderBy(asc(workflowStageArtifacts.position)),
        workflow.projectId
          ? db.query.projects.findFirst({ where: eq(projects.id, workflow.projectId), columns: { name: true } })
          : Promise.resolve(null),
      ]);

      const artifactIdsByStage = new Map<string, string[]>();
      for (const row of stageArtifactRows) {
        if (!artifactIdsByStage.has(row.stageId)) artifactIdsByStage.set(row.stageId, []);
        artifactIdsByStage.get(row.stageId)!.push(row.artifactId);
      }

      const parts: string[] = [];
      parts.push(`# ${workflow.name}`);
      if (workflow.description) parts.push(`_${workflow.description}_`);
      if (project) parts.push(`_Project: ${project.name}_`);
      parts.push("");

      const done = stageRows.filter((s) => s.status === "done").length;
      parts.push(`**Progress: ${done}/${stageRows.length} stages done**`);
      parts.push("");

      for (const stage of stageRows) {
        const check = stage.status === "done" ? "[x]" : stage.status === "doing" ? "[~]" : "[ ]";
        parts.push(`## ${check} ${stage.name} (id: ${stage.id})`);
        const artifactIds = artifactIdsByStage.get(stage.id) ?? [];
        const refs = artifactIds.flatMap((aid) => {
          const meta = searchMeta.get(aid);
          return meta ? [meta] : [];
        });
        if (refs.length === 0) {
          parts.push("_Nothing attached._");
        } else {
          for (const ref of refs) {
            const desc = ref.description ? ` — ${ref.description}` : "";
            parts.push(`- [${ref.kind}] ${ref.title}${desc} → ${usageHint(ref.kind, ref.fullSlug)}`);
          }
        }
        parts.push("");
      }

      return { content: [{ type: "text" as const, text: parts.join("\n").trimEnd() }] };
    },
  );

  // ── Tool: overview ───────────────────────────────────────────────────────
  // Not a search — a fast "homepage" for an agent that just connected: what
  // spaces/counts this token actually reaches, what's in flight, what's
  // popular, and where to go next. Built entirely from data already resolved
  // above (byKind counts, ownerSlugPaths, listAccessibleWorkflows) — no new
  // query beyond the small workflow-progress lookup it shares with
  // list_workflows.

  server.tool(
    "overview",
    "Get a fast orientation to this Agent Hub instance: what you can access, what's in progress, and what's popular. Call this first, before search_artifacts or list_* — it's a map, not a search.",
    {},
    async () => {
      const parts: string[] = [];
      parts.push("# Agent Hub overview");
      parts.push("");

      const spacePaths = [...new Set([...ownerSlugPaths.values()].filter(Boolean))].sort();
      const spaceLine =
        identity.systemRole === "superadmin"
          ? "all spaces (superadmin)"
          : spacePaths.length
            ? spacePaths.join(", ")
            : "personal space only";
      parts.push(`**Your access**: ${spaceLine}`);
      parts.push(
        `**Artifacts you can reach**: ${rows.length} prompts, ${skillRows.length} skills, ${kitRows.length} kits, ${planRows.length} plans, ${docRows.length} docs`,
      );
      parts.push("");

      const accessibleWorkflows = await listAccessibleWorkflows();
      parts.push("## In-flight workflows");
      if (!accessibleWorkflows.length) {
        parts.push("_None._");
      } else {
        const stages = await db.query.workflowStages.findMany({
          where: inArray(workflowStages.workflowId, accessibleWorkflows.map((w) => w.id)),
        });
        const doingByWorkflow = new Map<string, string>();
        for (const s of stages) {
          if (s.status === "doing" && !doingByWorkflow.has(s.workflowId)) doingByWorkflow.set(s.workflowId, s.name);
        }
        const inFlight = accessibleWorkflows.filter((w) => doingByWorkflow.has(w.id)).slice(0, 5);
        if (!inFlight.length) {
          parts.push("_None currently on a `doing` stage._");
        } else {
          for (const w of inFlight) {
            parts.push(`- ${w.name} — now: ${doingByWorkflow.get(w.id)} (id: ${w.id})`);
          }
        }
      }
      parts.push("");

      const allArtifacts = [...rows, ...skillRows, ...kitRows, ...planRows, ...docRows];
      const mostUsed = allArtifacts
        .filter((a) => a.fetchCount > 0)
        .sort((a, b) => b.fetchCount - a.fetchCount)
        .slice(0, 5);
      if (mostUsed.length) {
        parts.push("## Frequently used");
        for (const a of mostUsed) {
          parts.push(`- [${a.kind}] ${a.title} (${a.fetchCount} uses)`);
        }
        parts.push("");
      }

      parts.push(
        "Next: `search_artifacts` for something specific, or `list_workflows`/`get_workflow` to see a process's full stage structure.",
      );

      return { content: [{ type: "text" as const, text: parts.join("\n").trimEnd() }] };
    },
  );

  // ── Project tools ─────────────────────────────────────────────────────────
  // Projects aren't artifacts either (same reasoning as workflows above) —
  // visibility follows the plain user cone (D-016), mirroring the project
  // tRPC router exactly (server/trpc/routers/project.ts).

  async function listAccessibleProjects() {
    if (identity.systemRole === "superadmin") {
      return db.query.projects.findMany({ orderBy: desc(projects.updatedAt) });
    }
    const groups = await getAccessibleGroups(identity.userId, db);
    if (!groups.length) return [];
    const where = or(
      ...groups.map((g) => and(eq(projects.ownerGroupType, g.groupType), eq(projects.ownerGroupId, g.groupId))),
    );
    return db.query.projects.findMany({ where, orderBy: desc(projects.updatedAt) });
  }

  server.tool(
    "list_projects",
    "List projects (organizational groupings of docs/plans + members) you can see, with how many docs/plans and linked workflows each has.",
    {},
    async () => {
      const rows = await listAccessibleProjects();
      if (!rows.length) {
        return { content: [{ type: "text" as const, text: "No projects available." }] };
      }

      const [withCounts, workflowCounts] = await Promise.all([
        attachProjectCounts(rows, db),
        db
          .select({ projectId: workflows.projectId, count: sql<number>`count(*)::int` })
          .from(workflows)
          .where(inArray(workflows.projectId, rows.map((p) => p.id)))
          .groupBy(workflows.projectId),
      ]);
      const workflowCountByProject = new Map(workflowCounts.map((w) => [w.projectId, w.count]));

      const lines = withCounts.map((p) => {
        const workflowCount = workflowCountByProject.get(p.id) ?? 0;
        const desc = p.description ? ` — ${p.description}` : "";
        return `- ${p.name}${desc} (${p.artifactCount} doc/plan, ${p.memberCount} member${p.memberCount === 1 ? "" : "s"}, ${workflowCount} workflow${workflowCount === 1 ? "" : "s"}) (id: ${p.id})`;
      });

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_project",
    "Get a project's full context bundle — its assigned docs/plans as references (kind + slug + title) and any linked workflows (name + id + progress). Call get_doc/get_plan/get_workflow for the actual content of a reference.",
    {
      id: z.string().uuid().describe("The project id (from list_projects output)"),
    },
    async ({ id }) => {
      const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
      if (!project) {
        return { content: [{ type: "text" as const, text: `Project '${id}' not found.` }] };
      }
      const viewable = await canViewProject(identityUser, project, db);
      if (!viewable) {
        return { content: [{ type: "text" as const, text: `Access denied: project '${id}' is not accessible.` }] };
      }

      const [assignedRows, linkedWorkflowRows] = await Promise.all([
        db
          .select({ artifactId: projectArtifacts.artifactId })
          .from(projectArtifacts)
          .where(eq(projectArtifacts.projectId, project.id)),
        db.query.workflows.findMany({ where: eq(workflows.projectId, project.id) }),
      ]);

      const parts: string[] = [];
      parts.push(`# ${project.name}`);
      if (project.description) parts.push(`_${project.description}_`);
      parts.push("");

      // Same reasoning as get_workflow: resolving through searchMeta (already
      // scope-filtered) rather than a raw lookup means an assigned doc/plan
      // outside this token's scope is silently dropped, never leaked.
      const refs = assignedRows.flatMap(({ artifactId }) => {
        const meta = searchMeta.get(artifactId);
        return meta ? [meta] : [];
      });
      parts.push("## Docs & plans");
      if (refs.length === 0) {
        parts.push("_Nothing assigned._");
      } else {
        for (const ref of refs) {
          const d = ref.description ? ` — ${ref.description}` : "";
          parts.push(`- [${ref.kind}] ${ref.title}${d} → ${usageHint(ref.kind, ref.fullSlug)}`);
        }
      }
      parts.push("");

      const viewableWorkflows = [];
      for (const w of linkedWorkflowRows) {
        if (await canViewWorkflow(identityUser, w, db)) viewableWorkflows.push(w);
      }
      parts.push("## Linked workflows");
      if (viewableWorkflows.length === 0) {
        parts.push("_None._");
      } else {
        const withProgress = await attachWorkflowProgress(viewableWorkflows, db);
        for (const w of withProgress) {
          parts.push(`- ${w.name} (${w.doneCount}/${w.stageCount} stages done) (id: ${w.id})`);
        }
      }

      return { content: [{ type: "text" as const, text: parts.join("\n").trimEnd() }] };
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
      "set_workflow_stage_status",
      "Update the status of a workflow stage — report progress on a process. Only available with a write-enabled token.",
      {
        stageId: z.string().uuid().describe("The stage id (from get_workflow output)"),
        status: z.enum(["todo", "doing", "done"]).describe("New status"),
      },
      async ({ stageId, status }) => {
        const stage = await db.query.workflowStages.findFirst({ where: eq(workflowStages.id, stageId) });
        if (!stage) {
          return { content: [{ type: "text" as const, text: `Stage '${stageId}' not found.` }] };
        }
        const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, stage.workflowId) });
        if (!workflow || !(await canViewWorkflow(identityUser, workflow, db))) {
          return { content: [{ type: "text" as const, text: `Access denied: stage '${stageId}' is not in an accessible workflow.` }] };
        }
        await db.update(workflowStages).set({ status, updatedAt: new Date() }).where(eq(workflowStages.id, stageId));
        const stages = await db.query.workflowStages.findMany({
          where: eq(workflowStages.workflowId, workflow.id),
          orderBy: asc(workflowStages.position),
        });
        const done = stages.filter((s) => s.status === "done").length;
        const checklist = stages.map((s) => {
          const check = s.status === "done" ? "[x]" : s.status === "doing" ? "[~]" : "[ ]";
          return `- ${check} ${s.name}`;
        });
        return {
          content: [{ type: "text" as const, text: `Updated. Progress: ${done}/${stages.length} stages done\n\n${checklist.join("\n")}` }],
        };
      },
    );

    server.tool(
      "attach_artifact_to_workflow_stage",
      "Attach an artifact (prompt/skill/kit/plan/doc, by slug) to a workflow stage — the way work you just produced (e.g. a doc or plan you created) joins the process. Only available with a write-enabled token. Agents can only add; ask the user to remove or reorganize attachments in the app.",
      {
        stageId: z.string().uuid().describe("The stage id (from get_workflow output)"),
        slug: z.string().describe("The artifact's slug, exactly as shown by get_workflow/search_artifacts (e.g. 'acme.auth-bug' or 'auth-bug')"),
      },
      async ({ stageId, slug }) => {
        const stage = await db.query.workflowStages.findFirst({ where: eq(workflowStages.id, stageId) });
        if (!stage) {
          return { content: [{ type: "text" as const, text: `Stage '${stageId}' not found.` }] };
        }
        const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, stage.workflowId) });
        if (!workflow || !(await canManageWorkflow(identityUser, workflow.ownerGroupType, workflow.ownerGroupId, db))) {
          return { content: [{ type: "text" as const, text: `Access denied: you can't manage stage '${stageId}'.` }] };
        }

        // Resolving through searchMeta (not a raw artifact lookup) means an
        // artifact outside this token's scope — even if it exists and the
        // user could otherwise read it — resolves the same as "not found",
        // never a distinguishable "found but denied" response.
        const found = [...searchMeta.entries()].find(([, meta]) => meta.fullSlug === slug);
        if (!found) {
          return { content: [{ type: "text" as const, text: `Artifact '${slug}' not found or not accessible.` }] };
        }
        const [artifactId, meta] = found;

        const [{ maxPos }] = await db
          .select({ maxPos: sql<number>`coalesce(max(position), -1)` })
          .from(workflowStageArtifacts)
          .where(eq(workflowStageArtifacts.stageId, stageId));

        const [row] = await db
          .insert(workflowStageArtifacts)
          .values({ stageId, artifactId, position: maxPos + 1 })
          .onConflictDoNothing()
          .returning();

        const verb = row ? "Attached" : "Already attached";
        return {
          content: [{ type: "text" as const, text: `${verb}: [${meta.kind}] ${meta.title} → stage '${stage.name}'.` }],
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
    columns: { id: true, kind: true, title: true, description: true, slug: true, ownerType: true, ownerId: true, tags: true, fetchCount: true },
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
