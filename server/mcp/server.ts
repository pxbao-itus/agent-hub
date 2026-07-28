import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, asc, desc, and, or, sql, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks, artifactLinks, artifactComments, workflows, workflowStages, workflowStageArtifacts, projects, projectArtifacts, orgs, departments, teams, users } from "@/server/db/schema";
import { getAccessibleGroups, getSharedArtifactIds, effectiveGroupRole, canMutatePrompt } from "@/server/auth/access";
import { canViewWorkflow, canManageWorkflow, attachWorkflowProgress } from "@/server/lib/workflow-access";
import { canViewProject, canManageProject, attachProjectCounts } from "@/server/lib/project-access";
import { createArtifact, updateArtifact, syncVariables } from "@/server/services/artifact";
import { posix } from "node:path";
import { recordAudit } from "@/server/services/audit";
import { renderTemplate } from "@/server/lib/template";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { getCachedVersionContent } from "@/server/lib/version-cache";
import { hybridSearch } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { type TokenScope, applyScopeToOwners, promptPassesScopeTags } from "./scope";
import { createPlan, addPlanLink } from "@/server/services/plan";
import { addAssignee, getAssignmentDetail, removeAssignee, setAssigner, updateWorkItem } from "@/server/services/assignment";
import { listMyWork } from "@/server/services/my-work";
import { createComment, deleteComment, listComments, updateComment } from "@/server/services/comment";
import { setSubscription } from "@/server/services/subscription";
import { slugify } from "@/lib/slug";
import type { ArtifactKind } from "@/server/db/schema";

type Identity = { userId: string; systemRole: "user" | "superadmin" };

/**
 * Build a per-request MCP server.
 * Each accessible prompt is registered as its own named slash command
 * so agents can invoke prompts directly without going through list/get.
 */
const ALL_KINDS: ArtifactKind[] = ["prompt", "skill", "plan", "doc"];

// Reusable input schema for renaming an artifact's slug via the update_* tools.
// Same rule as the tRPC router's slugSchema: lowercase alphanumeric + hyphens.
const newSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens")
  .max(100)
  .optional()
  .describe("Rename the artifact's slug (lowercase, alphanumeric + hyphens). Must be unique within its owner space. Omit to leave unchanged.");

const SERVER_INSTRUCTIONS =
  "Agent Hub is a shared library of prompts, skills, plans, docs, and workflows. " +
  "Prompts are exposed as native prompts/slash-commands; everything else is fetched with get_skill/get_plan/get_doc/get_workflow. " +
  "Start with the `overview` tool to see what's here before searching blind.";

export async function createMcpServer(identity: Identity, scope: TokenScope = {}): Promise<McpServer> {
  const server = new McpServer(
    { name: "agent-hub", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // One access resolution + one query for every kind
  // (Phase 39 perf) — getAccessibleGroups/getSharedArtifactIds/findMany were
  // each re-run per kind despite returning the same thing every time.
  const byKind = await getArtifactsForIdentity(identity, scope, ALL_KINDS);
  const rows = byKind.prompt;
  const skillRows = byKind.skill;
  const planRows = byKind.plan;
  const docRows = byKind.doc;
  const identityUser = { userId: identity.userId, systemRole: identity.systemRole };

  // Resolve hierarchical slug paths for every owner across every kind in one
  // batch — same reasoning: this is a pure lookup by owner identity, not by
  // which kind asked for it, so one shared map is correct for all five.
  const ownerSlugPaths = await resolveOwnerSlugPaths(
    [...rows, ...skillRows, ...planRows, ...docRows].map((r) => ({
      ownerType: r.ownerType,
      ownerId: r.ownerId,
    })),
    db,
  );
  const skillOwnerPaths = ownerSlugPaths;
  const docOwnerPaths = ownerSlugPaths;
  const planOwnerPaths = ownerSlugPaths;

  async function formatAssignmentSection(
    artifact: Pick<(typeof planRows)[number], "id" | "ownerType" | "ownerId" | "createdBy">,
  ): Promise<string[]> {
    const { assignerId, assigneeIds, workItem } = await getAssignmentDetail(artifact, db);
    const userIds = [...new Set([assignerId, ...assigneeIds].filter((id): id is string => Boolean(id)))];
    const userRows = userIds.length
      ? await db.query.users.findMany({
          where: inArray(users.id, userIds),
          columns: { id: true, name: true, email: true },
        })
      : [];
    const userById = new Map(userRows.map((user) => [user.id, user]));
    const displayUser = (userId: string | null) => {
      if (!userId) return "None";
      const user = userById.get(userId);
      if (!user) return "Unknown user";
      return `${user.name ?? user.email} <${user.email}>`;
    };

    const lines = [
      "## Assignment",
      `- Status: ${workItem.status}`,
      `- Priority: ${workItem.priority}`,
      `- Due date: ${workItem.dueDate ?? "None"}`,
      `- Assigner: ${displayUser(assignerId)}`,
    ];
    if (assigneeIds.length === 0) {
      lines.push("- Assignees: None");
    } else {
      lines.push("- Assignees:");
      for (const assigneeId of assigneeIds) lines.push(`  - ${displayUser(assigneeId)}`);
    }
    return lines;
  }

  const seen = new Set<string>();

  // Pre-seed `seen` with all explicit slugs (across all spaces) to prevent collisions
  for (const p of rows) {
    if (p.slug) {
      const spacePath = ownerSlugPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
      const full = [spacePath, p.slug].filter(Boolean).join(".");
      seen.add(full);
    }
  }

  // slug → prompt map (Phase 51) — mirrors skillBySlug/docBySlug/planBySlug,
  // reusing the slug this same loop already computes for registerPrompt()
  // instead of resolving it a second time.
  const promptBySlug = new Map<string, typeof rows[number]>();

  for (const p of rows) {
    const body = p.versions[0]?.body ?? "";
    if (!body) continue;

    const spacePath = ownerSlugPaths.get(`${p.ownerType}:${p.ownerId}`) ?? "";
    const localSlug = p.slug ?? uniqueSlug(p.title, p.id, seen);
    const slug = [spacePath, localSlug].filter(Boolean).join(".");

    promptBySlug.set(slug, p);
    if (slug !== localSlug) promptBySlug.set(localSlug, p);

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

  // ── Tool: get_prompt ──────────────────────────────────────────────────────
  // Raw body + variable names, no rendering/substitution — that's the native
  // `prompts` primitive's job (getPrompt). This is a fallback for clients
  // that don't surface prompts well, and for reading a template before
  // forking/editing it (Phase 51).

  server.tool(
    "get_prompt",
    "Get a prompt template's raw body and {{variable}} names by slug. Does NOT render or substitute variables — for that, invoke the prompt through the native `prompts` primitive (getPrompt). Use this to read a template's source before forking/editing it, or when a client doesn't surface prompts well.",
    {
      slug: z.string().describe("The prompt slug (e.g. 'acme.code-review' or 'code-review')"),
    },
    async ({ slug }) => {
      const prompt = promptBySlug.get(slug);
      if (!prompt) {
        const available = [...promptBySlug.keys()].slice(0, 10).join(", ");
        return {
          content: [{
            type: "text" as const,
            text: `Prompt '${slug}' not found.${available ? ` Available prompts: ${available}` : ""}`,
          }],
        };
      }

      bumpUsage(prompt.id);
      const version = prompt.versions[0];
      const parts: string[] = [];
      parts.push(`# ${prompt.title}`);
      if (prompt.description) parts.push(`_${prompt.description}_`);
      parts.push("");
      if (version?.body) parts.push(version.body);
      if (prompt.variables.length > 0) {
        parts.push("");
        parts.push(`Variables: ${prompt.variables.map((v) => `{{${v.name}}}`).join(", ")}`);
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );

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
      case "plan": return `get_plan('${fullSlug}')`;
      case "doc": return `get_doc('${fullSlug}')`;
    }
  };

  server.tool(
    "search_artifacts",
    "Search across everything you can access — prompts, skills, plans, and docs — by meaning or keywords. Returns matches with their slug and how to use each one.",
    {
      query: z.string().describe("What you're looking for — describe the task or topic"),
      kinds: z
        .array(z.enum(["prompt", "skill", "plan", "doc"]))
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

      parts.push("");
      parts.push(...(await formatAssignmentSection(plan)));

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
      parts.push("");
      parts.push(...(await formatAssignmentSection(doc)));

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );

  const scopedWorkItemIds = new Set([...planRows, ...docRows].map((artifact) => artifact.id));
  const collaborationBySlug = {
    doc: docBySlug,
    plan: planBySlug,
  };

  server.tool(
    "list_comments",
    "List discussion comments for an accessible Doc or Plan. Results include tombstones, source attribution, mentions, and a cursor for earlier comments.",
    {
      kind: z.enum(["doc", "plan"]),
      slug: z.string().describe("The scoped Doc or Plan slug"),
      limit: z.number().int().min(1).max(100).default(20),
      before: z.string().optional().describe("Cursor returned by an earlier list_comments call"),
    },
    async ({ kind, slug, limit, before }) => {
      const artifact = collaborationBySlug[kind].get(slug);
      if (!artifact) {
        return { content: [{ type: "text" as const, text: `${kind === "doc" ? "Doc" : "Plan"} '${slug}' not found or not accessible.` }] };
      }
      const result = await listComments(artifact, identityUser, { cursor: before, limit }, db);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            comments: result.items.map((comment) => ({
              id: comment.id,
              author: comment.author
                ? {
                    name: comment.author.name,
                    username: comment.author.username,
                  }
                : null,
              source: comment.source,
              createdAt: comment.createdAt,
              updatedAt: comment.updatedAt,
              deleted: Boolean(comment.deletedAt),
              body: comment.deletedAt ? null : comment.body,
              mentions: comment.mentions.flatMap((mention) =>
                mention.user.username ? [mention.user.username] : [],
              ),
            })),
            nextCursor: result.nextCursor,
          }),
        }],
      };
    },
  );

  server.tool(
    "list_my_work",
    "List Docs and Plans assigned to you, coordinated by you, or still unassigned. Results respect this token's access scope.",
    {
      view: z.enum(["assigned_to_me", "coordinated_by_me", "unassigned"]).default("assigned_to_me"),
      kind: z.enum(["doc", "plan"]).optional(),
      status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      due: z.enum(["overdue", "today", "next_7_days", "no_due_date"]).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    async ({ view, kind, status, priority, due, limit }) => {
      const result = await listMyWork(
        identityUser,
        {
          view,
          kind,
          status: status ? [status] : undefined,
          priority: priority ? [priority] : undefined,
          due,
          // Apply token scoping after the bounded service query. Fetching the
          // maximum prevents earlier out-of-scope rows from hiding valid items.
          limit: 100,
          sort: "due_date",
        },
        db,
      );
      const items = result.items.filter((item) => scopedWorkItemIds.has(item.artifact.id)).slice(0, limit);
      if (items.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching work items." }] };
      }
      const lines = items.map((item) => {
        const source = item.artifact.kind === "plan"
          ? planBySlug
          : docBySlug;
        const slug = [...source.entries()].find(([, artifact]) => artifact.id === item.artifact.id)?.[0] ?? item.artifact.id;
        return `- [${item.artifact.kind}] ${slug}: ${item.artifact.title} — status=${item.status}, priority=${item.priority}, due=${item.dueDate ?? "none"}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
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
    "List processes/workflows you can see — ordered stages that tie docs, plans, prompts, and skills together across a lifecycle (spec, build, review, ...). Shows progress and which stage is active.",
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
    "Get a workflow's full stage structure — ordered stages with status, and each stage's attached artifacts as references (kind + slug + title). Call get_doc/get_skill/get_plan for the actual content of a reference.",
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
        `**Artifacts you can reach**: ${rows.length} prompts, ${skillRows.length} skills, ${planRows.length} plans, ${docRows.length} docs`,
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

      const allArtifacts = [...rows, ...skillRows, ...planRows, ...docRows];
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

  // ── Group tools ───────────────────────────────────────────────────────────
  // Groups (org/department/team) are the non-personal owner spaces. This tool
  // lets an agent discover the (ownerType, ownerId) pairs it needs to create an
  // artifact in a group space via create_plan/create_skill/create_doc/create_prompt.
  server.tool(
    "list_groups",
    "List the org/department/team group spaces you can access, each with id, type, name, path, and whether you can write to it (canWrite). To create an artifact in a group space, pass groupType as `ownerType` and id as `ownerId` to create_plan/create_skill/create_doc/create_prompt. Your personal space (ownerType: 'user') is always available and is not listed here.",
    {
      writableOnly: z
        .boolean()
        .default(false)
        .describe("Only return groups where you have editor/admin (canWrite=true)."),
    },
    async ({ writableOnly }) => {
      // Superadmin sees every group (mirrors listAccessibleProjects); everyone
      // else gets their D-016 read cone.
      let groupRefs: { groupType: "org" | "department" | "team"; groupId: string }[];
      if (identity.systemRole === "superadmin") {
        const [orgRows, deptRows, teamRows] = await Promise.all([
          db.query.orgs.findMany({ columns: { id: true } }),
          db.query.departments.findMany({ columns: { id: true } }),
          db.query.teams.findMany({ columns: { id: true } }),
        ]);
        groupRefs = [
          ...orgRows.map((o) => ({ groupType: "org" as const, groupId: o.id })),
          ...deptRows.map((d) => ({ groupType: "department" as const, groupId: d.id })),
          ...teamRows.map((t) => ({ groupType: "team" as const, groupId: t.id })),
        ];
      } else {
        groupRefs = await getAccessibleGroups(identity.userId, db);
      }

      if (!groupRefs.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No group spaces available. You can still create artifacts in your personal space (ownerType: 'user').",
            },
          ],
        };
      }

      // Cap output (no pagination in v1 — self-host scale). Note truncation so
      // the agent knows the list is incomplete rather than assuming it's whole.
      const CAP = 200;
      const truncated = groupRefs.length > CAP;
      const capped = groupRefs.slice(0, CAP);

      const orgIds = capped.filter((g) => g.groupType === "org").map((g) => g.groupId);
      const deptIds = capped.filter((g) => g.groupType === "department").map((g) => g.groupId);
      const teamIds = capped.filter((g) => g.groupType === "team").map((g) => g.groupId);

      const [orgRows, deptRows, teamRows, paths] = await Promise.all([
        orgIds.length ? db.query.orgs.findMany({ where: inArray(orgs.id, orgIds), columns: { id: true, name: true } }) : [],
        deptIds.length ? db.query.departments.findMany({ where: inArray(departments.id, deptIds), columns: { id: true, name: true } }) : [],
        teamIds.length ? db.query.teams.findMany({ where: inArray(teams.id, teamIds), columns: { id: true, name: true } }) : [],
        resolveOwnerSlugPaths(capped.map((g) => ({ ownerType: g.groupType, ownerId: g.groupId })), db),
      ]);
      const nameByKey = new Map<string, string>();
      for (const o of orgRows) nameByKey.set(`org:${o.id}`, o.name);
      for (const d of deptRows) nameByKey.set(`department:${d.id}`, d.name);
      for (const t of teamRows) nameByKey.set(`team:${t.id}`, t.name);

      // canWrite mirrors the create_* group-role gate: editor/admin can write.
      const roleByKey = new Map<string, string | null>();
      await Promise.all(
        capped.map(async (g) => {
          const key = `${g.groupType}:${g.groupId}`;
          if (identity.systemRole === "superadmin") {
            roleByKey.set(key, "admin");
            return;
          }
          roleByKey.set(key, await effectiveGroupRole(identity.userId, g.groupType, g.groupId, db));
        }),
      );

      let items = capped.map((g) => {
        const key = `${g.groupType}:${g.groupId}`;
        const role = roleByKey.get(key);
        return {
          groupType: g.groupType,
          id: g.groupId,
          name: nameByKey.get(key) ?? "(unknown)",
          path: paths.get(key) ?? "",
          canWrite: role === "editor" || role === "admin",
        };
      });
      if (writableOnly) items = items.filter((i) => i.canWrite);

      if (!items.length) {
        return {
          content: [
            { type: "text" as const, text: "No writable group spaces (you have viewer-only access to the groups you can see)." },
          ],
        };
      }

      const lines = items.map(
        (i) =>
          `- [${i.groupType}] ${i.name}${i.path ? ` (${i.path})` : ""} — canWrite: ${i.canWrite} (ownerType: ${i.groupType}, ownerId: ${i.id})`,
      );
      if (truncated) lines.push(`\n_…truncated to ${CAP} of ${groupRefs.length} groups._`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // Write tools are only registered when the token has write=true
  if (scope.write === true) {
    const accessiblePlanIds = new Set(planRows.map((p) => p.id));
    const accessibleCollaborationIds = new Set([...planRows, ...docRows].map((artifact) => artifact.id));

    server.tool(
      "add_comment",
      "Add a Markdown comment to an accessible Doc or Plan. Put @username directly in the body to mention a user. Only available with a write-enabled token.",
      {
        kind: z.enum(["doc", "plan"]),
        slug: z.string().describe("The scoped Doc or Plan slug"),
        body: z.string().min(1).max(20_000),
      },
      async ({ kind, slug, body }) => {
        const artifact = collaborationBySlug[kind].get(slug);
        if (!artifact) {
          return { content: [{ type: "text" as const, text: `${kind === "doc" ? "Doc" : "Plan"} '${slug}' not found or not accessible.` }] };
        }
        const result = await createComment(artifact, { body }, identityUser, "mcp", db);
        const warning = result.unresolvedMentions.length
          ? ` Unresolved or inaccessible mentions: ${result.unresolvedMentions.map((username) => `@${username}`).join(", ")}.`
          : "";
        return {
          content: [{
            type: "text" as const,
            text: `Comment added (id: ${result.comment.id}, source: mcp).${warning}`,
          }],
        };
      },
    );

    server.tool(
      "update_comment",
      "Update one of your comments. The comment must belong to a Doc or Plan in this token's scope. Only available with a write-enabled token.",
      {
        commentId: z.string().uuid(),
        body: z.string().min(1).max(20_000),
      },
      async ({ commentId, body }) => {
        const comment = await db.query.artifactComments.findFirst({
          where: eq(artifactComments.id, commentId),
          columns: { artifactId: true },
        });
        if (!comment || !accessibleCollaborationIds.has(comment.artifactId)) {
          return { content: [{ type: "text" as const, text: `Comment '${commentId}' not found or not accessible.` }] };
        }
        const result = await updateComment(commentId, { body }, identityUser, db);
        const warning = result.unresolvedMentions.length
          ? ` Unresolved or inaccessible mentions: ${result.unresolvedMentions.map((username) => `@${username}`).join(", ")}.`
          : "";
        return { content: [{ type: "text" as const, text: `Comment updated.${warning}` }] };
      },
    );

    server.tool(
      "delete_comment",
      "Delete one of your comments, or moderate a comment when you manage its artifact. The comment must be in this token's scope. Only available with a write-enabled token.",
      { commentId: z.string().uuid() },
      async ({ commentId }) => {
        const comment = await db.query.artifactComments.findFirst({
          where: eq(artifactComments.id, commentId),
          columns: { artifactId: true },
        });
        if (!comment || !accessibleCollaborationIds.has(comment.artifactId)) {
          return { content: [{ type: "text" as const, text: `Comment '${commentId}' not found or not accessible.` }] };
        }
        await deleteComment(commentId, identityUser, db);
        return { content: [{ type: "text" as const, text: "Comment deleted." }] };
      },
    );

    server.tool(
      "set_follow_preference",
      "Set your notification preference for an accessible Doc or Plan. Only available with a write-enabled token.",
      {
        kind: z.enum(["doc", "plan"]),
        slug: z.string().describe("The scoped Doc or Plan slug"),
        mode: z.enum(["all", "mentions", "muted"]),
      },
      async ({ kind, slug, mode }) => {
        const artifact = collaborationBySlug[kind].get(slug);
        if (!artifact) {
          return { content: [{ type: "text" as const, text: `${kind === "doc" ? "Doc" : "Plan"} '${slug}' not found or not accessible.` }] };
        }
        await setSubscription(artifact, mode, identityUser, db);
        return { content: [{ type: "text" as const, text: `Follow preference set to '${mode}'.` }] };
      },
    );

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
      "Attach an artifact (prompt/skill/plan/doc, by slug) to a workflow stage — the way work you just produced (e.g. a doc or plan you created) joins the process. Only available with a write-enabled token. Agents can only add; ask the user to remove or reorganize attachments in the app.",
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
            // Group owners can't be "private" (assertGroupVisibility in the
            // tRPC router rejects that combination; more fundamentally, a
            // private group-owned artifact would be invisible to everyone
            // via getArtifactsForIdentity's read cone — even its own creator
            // on a later connection, since that cone only grants group
            // access when visibility is "group").
            visibility: ownerType === "user" ? "private" : "group",
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
      "update_plan",
      "Update an existing plan's overview or metadata. Omitted fields are left unchanged. Providing body creates a new version. Does not touch tasks — use add_plan_task/update_plan_task/delete_plan_task/update_task_status for those.",
      {
        slug: z.string().describe("The plan slug (e.g. 'acme.sprint-1' or 'sprint-1')"),
        title: z.string().min(1).max(200).optional().describe("New title"),
        newSlug: newSlugSchema,
        body: z.string().min(1).optional().describe("New overview/background markdown (creates a new version)"),
        description: z.string().max(500).optional().describe("New short description"),
        tags: z.array(z.string()).optional().describe("Replace the tag list entirely"),
      },
      async ({ slug, title, newSlug, body, description, tags }) => {
        const plan = planBySlug.get(slug);
        if (!plan) {
          return { content: [{ type: "text" as const, text: `Plan '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, plan, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot edit plan '${slug}'.` }] };
        }
        if (newSlug !== undefined && (await isSlugTaken(newSlug, plan))) {
          return { content: [{ type: "text" as const, text: `Slug '${newSlug}' is already taken in this space.` }] };
        }

        await updateArtifact(plan.id, { title, slug: newSlug, description, tags, body, updatedBy: identity.userId }, db);
        const suffix = newSlug !== undefined ? ` (slug is now '${newSlug}')` : "";
        return { content: [{ type: "text" as const, text: `Plan '${slug}' updated${suffix}.` }] };
      },
    );

    server.tool(
      "delete_plan",
      "Delete a plan (and its tasks). This cannot be undone.",
      {
        slug: z.string().describe("The plan slug (e.g. 'acme.sprint-1' or 'sprint-1')"),
      },
      async ({ slug }) => {
        const plan = planBySlug.get(slug);
        if (!plan) {
          return { content: [{ type: "text" as const, text: `Plan '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, plan, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot delete plan '${slug}'.` }] };
        }

        await db.delete(artifacts).where(eq(artifacts.id, plan.id));
        await recordAudit(
          { actorId: identity.userId, action: "artifact.delete", targetType: "artifact", targetId: plan.id, metadata: { kind: "plan", title: plan.title } },
          db,
        );
        return { content: [{ type: "text" as const, text: `Plan '${slug}' deleted.` }] };
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

    server.tool(
      "update_doc",
      "Update an existing doc's content or metadata. Omitted fields are left unchanged. Providing body creates a new version.",
      {
        slug: z.string().describe("The doc slug (e.g. 'acme.auth-bug' or 'auth-bug')"),
        title: z.string().min(1).max(200).optional().describe("New title"),
        newSlug: newSlugSchema,
        body: z.string().min(1).optional().describe("New full markdown content (creates a new version)"),
        description: z.string().max(500).optional().describe("New short one-line summary"),
        tags: z.array(z.string()).optional().describe("Replace the tag list entirely"),
      },
      async ({ slug, title, newSlug, body, description, tags }) => {
        const doc = docBySlug.get(slug);
        if (!doc) {
          return { content: [{ type: "text" as const, text: `Doc '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, doc, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot edit doc '${slug}'.` }] };
        }
        if (newSlug !== undefined && (await isSlugTaken(newSlug, doc))) {
          return { content: [{ type: "text" as const, text: `Slug '${newSlug}' is already taken in this space.` }] };
        }

        await updateArtifact(doc.id, { title, slug: newSlug, description, tags, body, updatedBy: identity.userId }, db);
        const suffix = newSlug !== undefined ? ` (slug is now '${newSlug}')` : "";
        return { content: [{ type: "text" as const, text: `Doc '${slug}' updated${suffix}.` }] };
      },
    );

    server.tool(
      "delete_doc",
      "Delete a doc. This cannot be undone.",
      {
        slug: z.string().describe("The doc slug (e.g. 'acme.auth-bug' or 'auth-bug')"),
      },
      async ({ slug }) => {
        const doc = docBySlug.get(slug);
        if (!doc) {
          return { content: [{ type: "text" as const, text: `Doc '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, doc, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot delete doc '${slug}'.` }] };
        }

        await db.delete(artifacts).where(eq(artifacts.id, doc.id));
        await recordAudit(
          { actorId: identity.userId, action: "artifact.delete", targetType: "artifact", targetId: doc.id, metadata: { kind: "doc", title: doc.title } },
          db,
        );
        return { content: [{ type: "text" as const, text: `Doc '${slug}' deleted.` }] };
      },
    );

    server.tool(
      "create_skill",
      "Create a new skill (reusable instructions an agent can follow), optionally with bundled files. In your personal space by default.",
      {
        title: z.string().min(1).max(200).describe("Skill title"),
        body: z.string().min(1).describe("The SKILL.md instructions body (markdown)"),
        description: z.string().max(500).optional().describe("Short one-line summary"),
        tags: z.array(z.string()).default([]).describe("Tags e.g. ['gitlab', 'review']"),
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(500).describe("Relative file path, e.g. 'scripts/check.sh'"),
              content: z.string(),
              mimeType: z.string().optional(),
            }),
          )
          .default([])
          .describe("Bundled files attached to this skill"),
        ownerType: z.enum(["user", "org", "department", "team"]).default("user").describe("Owner space. 'user' = personal (default). For group spaces the token user must have editor/admin role in that group."),
        ownerId: z.string().uuid().optional().describe("Group ID when ownerType is not 'user'. Omit for personal space."),
      },
      async ({ title, body, description, tags, files, ownerType, ownerId }) => {
        const ownerIdResolved = ownerType === "user" ? identity.userId : (ownerId ?? identity.userId);

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

        const pathError = assertSafeFilePaths(files);
        if (pathError) {
          return { content: [{ type: "text" as const, text: pathError }] };
        }

        const skill = await createArtifact(
          {
            kind: "skill",
            ownerType,
            ownerId: ownerIdResolved,
            title,
            description,
            tags,
            // See create_plan's comment above — group owners can't be "private".
            visibility: ownerType === "user" ? "private" : "group",
            body,
            files,
            createdBy: identity.userId,
          },
          db,
        );

        const skillSlug = skill.slug ?? slugify(title);
        let msg = `Skill created: '${skillSlug}' (id: ${skill.id})`;
        if (files.length > 0) msg += `\nFiles attached: ${files.length}`;
        return { content: [{ type: "text" as const, text: msg }] };
      },
    );

    server.tool(
      "update_skill",
      "Update an existing skill's content or metadata. Omitted fields are left unchanged. Providing body creates a new version; files (if provided) replace the entire bundled-file set on that new version — files are only applied together with a new body, since files live on a specific version.",
      {
        slug: z.string().describe("The skill slug (e.g. 'acme.code-review' or 'code-review')"),
        title: z.string().min(1).max(200).optional().describe("New title"),
        newSlug: newSlugSchema,
        body: z.string().min(1).optional().describe("New SKILL.md instructions body (creates a new version)"),
        description: z.string().max(500).optional().describe("New short one-line summary"),
        tags: z.array(z.string()).optional().describe("Replace the tag list entirely"),
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(500).describe("Relative file path, e.g. 'scripts/check.sh'"),
              content: z.string(),
              mimeType: z.string().optional(),
            }),
          )
          .optional()
          .describe("Replace the entire bundled-file set (only applied when body is also provided)"),
      },
      async ({ slug, title, newSlug, body, description, tags, files }) => {
        const skill = skillBySlug.get(slug);
        if (!skill) {
          return { content: [{ type: "text" as const, text: `Skill '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, skill, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot edit skill '${slug}'.` }] };
        }
        if (newSlug !== undefined && (await isSlugTaken(newSlug, skill))) {
          return { content: [{ type: "text" as const, text: `Slug '${newSlug}' is already taken in this space.` }] };
        }

        if (files?.length) {
          const pathError = assertSafeFilePaths(files);
          if (pathError) {
            return { content: [{ type: "text" as const, text: pathError }] };
          }
        }

        await updateArtifact(skill.id, { title, slug: newSlug, description, tags, body, files, updatedBy: identity.userId }, db);
        const suffix = newSlug !== undefined ? ` (slug is now '${newSlug}')` : "";
        return { content: [{ type: "text" as const, text: `Skill '${slug}' updated${suffix}.` }] };
      },
    );

    server.tool(
      "delete_skill",
      "Delete a skill (and its bundled files). This cannot be undone.",
      {
        slug: z.string().describe("The skill slug (e.g. 'acme.code-review' or 'code-review')"),
      },
      async ({ slug }) => {
        const skill = skillBySlug.get(slug);
        if (!skill) {
          return { content: [{ type: "text" as const, text: `Skill '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, skill, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot delete skill '${slug}'.` }] };
        }

        await db.delete(artifacts).where(eq(artifacts.id, skill.id));
        await recordAudit(
          { actorId: identity.userId, action: "artifact.delete", targetType: "artifact", targetId: skill.id, metadata: { kind: "skill", title: skill.title } },
          db,
        );
        return { content: [{ type: "text" as const, text: `Skill '${slug}' deleted.` }] };
      },
    );

    server.tool(
      "create_prompt",
      "Create a new reusable prompt template. Any {{variable}} placeholder in the body becomes a fillable argument when the prompt is invoked. In your personal space by default.",
      {
        title: z.string().min(1).max(200).describe("Prompt title"),
        body: z.string().min(1).describe("The template body, e.g. 'Summarize {{topic}} in {{tone}} tone.'"),
        description: z.string().max(500).optional().describe("Short one-line summary"),
        tags: z.array(z.string()).default([]).describe("Tags e.g. ['writing', 'summary']"),
        ownerType: z.enum(["user", "org", "department", "team"]).default("user").describe("Owner space. 'user' = personal (default). For group spaces the token user must have editor/admin role in that group."),
        ownerId: z.string().uuid().optional().describe("Group ID when ownerType is not 'user'. Omit for personal space."),
      },
      async ({ title, body, description, tags, ownerType, ownerId }) => {
        const ownerIdResolved = ownerType === "user" ? identity.userId : (ownerId ?? identity.userId);

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

        const prompt = await createArtifact(
          {
            kind: "prompt",
            ownerType,
            ownerId: ownerIdResolved,
            title,
            description,
            tags,
            // See create_plan's comment above — group owners can't be "private".
            visibility: ownerType === "user" ? "private" : "group",
            body,
            createdBy: identity.userId,
          },
          db,
        );
        await syncVariables(db, prompt.id, body);

        const promptSlug = prompt.slug ?? slugify(title);
        return { content: [{ type: "text" as const, text: `Prompt created: '${promptSlug}' (id: ${prompt.id})` }] };
      },
    );

    server.tool(
      "update_prompt",
      "Update an existing prompt's template or metadata. Omitted fields are left unchanged. Providing body creates a new version and re-syncs its {{variable}} placeholders.",
      {
        slug: z.string().describe("The prompt slug (e.g. 'acme.code-review' or 'code-review')"),
        title: z.string().min(1).max(200).optional().describe("New title"),
        newSlug: newSlugSchema,
        body: z.string().min(1).optional().describe("New template body (creates a new version, re-syncs variables)"),
        description: z.string().max(500).optional().describe("New short one-line summary"),
        tags: z.array(z.string()).optional().describe("Replace the tag list entirely"),
      },
      async ({ slug, title, newSlug, body, description, tags }) => {
        const prompt = promptBySlug.get(slug);
        if (!prompt) {
          return { content: [{ type: "text" as const, text: `Prompt '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, prompt, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot edit prompt '${slug}'.` }] };
        }
        if (newSlug !== undefined && (await isSlugTaken(newSlug, prompt))) {
          return { content: [{ type: "text" as const, text: `Slug '${newSlug}' is already taken in this space.` }] };
        }

        await updateArtifact(prompt.id, { title, slug: newSlug, description, tags, body, updatedBy: identity.userId }, db);
        if (body !== undefined) {
          await syncVariables(db, prompt.id, body);
        }
        const suffix = newSlug !== undefined ? ` (slug is now '${newSlug}')` : "";
        return { content: [{ type: "text" as const, text: `Prompt '${slug}' updated${suffix}.` }] };
      },
    );

    server.tool(
      "delete_prompt",
      "Delete a prompt. This cannot be undone.",
      {
        slug: z.string().describe("The prompt slug (e.g. 'acme.code-review' or 'code-review')"),
      },
      async ({ slug }) => {
        const prompt = promptBySlug.get(slug);
        if (!prompt) {
          return { content: [{ type: "text" as const, text: `Prompt '${slug}' not found.` }] };
        }
        const allowed = await canMutatePrompt(identityUser, prompt, db);
        if (!allowed) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot delete prompt '${slug}'.` }] };
        }

        await db.delete(artifacts).where(eq(artifacts.id, prompt.id));
        await recordAudit(
          { actorId: identity.userId, action: "artifact.delete", targetType: "artifact", targetId: prompt.id, metadata: { kind: "prompt", title: prompt.title } },
          db,
        );
        return { content: [{ type: "text" as const, text: `Prompt '${slug}' deleted.` }] };
      },
    );

    // ── Project assignment ───────────────────────────────────────────────────
    // Projects are a many-to-many grouping over doc|plan artifacts (orthogonal
    // to ownership) — mirror project.assignArtifact/unassignArtifact exactly:
    // manage-rights on the project's owning group + doc|plan kind. Presence in
    // planBySlug/docBySlug already implies the artifact is readable by this
    // token, so no extra read check is needed.
    const resolveDocOrPlan = (
      slug: string,
      kind?: "doc" | "plan",
    ):
      | {
          ok: true;
          id: string;
          kind: "doc" | "plan";
          title: string;
          artifact: (typeof planRows)[number];
        }
      | { ok: false; message: string } => {
      const plan = planBySlug.get(slug);
      const doc = docBySlug.get(slug);
      if (kind === "plan") {
        return plan ? { ok: true, id: plan.id, kind: "plan", title: plan.title, artifact: plan } : { ok: false, message: `Plan '${slug}' not found or not accessible.` };
      }
      if (kind === "doc") {
        return doc ? { ok: true, id: doc.id, kind: "doc", title: doc.title, artifact: doc } : { ok: false, message: `Doc '${slug}' not found or not accessible.` };
      }
      if (plan && doc) {
        return { ok: false, message: `Slug '${slug}' matches both a doc and a plan — pass kind ("doc" or "plan") to disambiguate.` };
      }
      if (plan) return { ok: true, id: plan.id, kind: "plan", title: plan.title, artifact: plan };
      if (doc) return { ok: true, id: doc.id, kind: "doc", title: doc.title, artifact: doc };
      return { ok: false, message: `No doc or plan found with slug '${slug}' (or not accessible).` };
    };

    async function resolveAssignmentTarget(email: string) {
      return db.query.users.findFirst({
        where: sql`lower(${users.email}) = lower(${email})`,
        columns: { id: true, name: true, email: true },
      });
    }

    const assignmentToolInput = {
      slug: z.string().describe("Slug of the doc or plan"),
      kind: z.enum(["doc", "plan"]).optional().describe("Disambiguate when a doc and a plan share the same slug"),
      email: z.string().email().describe("Email of the target user"),
    };

    server.tool(
      "set_assigner",
      "Set the assigner for a doc or plan. The target must already be able to view the artifact. Requires artifact edit permission.",
      assignmentToolInput,
      async ({ slug, kind, email }) => {
        const resolved = resolveDocOrPlan(slug, kind);
        if (!resolved.ok) return { content: [{ type: "text" as const, text: resolved.message }] };
        if (!(await canMutatePrompt(identityUser, resolved.artifact, db))) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot manage assignment for '${slug}'.` }] };
        }
        const target = await resolveAssignmentTarget(email);
        if (!target) {
          return { content: [{ type: "text" as const, text: "Target user not found or cannot be assigned." }] };
        }
        const result = await setAssigner(resolved.artifact, target.id, identity.userId, db);
        if (!result.ok) return { content: [{ type: "text" as const, text: result.message }] };
        const verb = result.changed ? "Set" : "Already";
        return {
          content: [{
            type: "text" as const,
            text: `${verb} assigner: ${target.name ?? target.email} <${target.email}> for [${resolved.kind}] '${slug}'.`,
          }],
        };
      },
    );

    server.tool(
      "add_assignee",
      "Add an assignee to a doc or plan. The target must already be able to view the artifact. Requires artifact edit permission.",
      assignmentToolInput,
      async ({ slug, kind, email }) => {
        const resolved = resolveDocOrPlan(slug, kind);
        if (!resolved.ok) return { content: [{ type: "text" as const, text: resolved.message }] };
        if (!(await canMutatePrompt(identityUser, resolved.artifact, db))) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot manage assignment for '${slug}'.` }] };
        }
        const target = await resolveAssignmentTarget(email);
        if (!target) {
          return { content: [{ type: "text" as const, text: "Target user not found or cannot be assigned." }] };
        }
        const result = await addAssignee(resolved.artifact, target.id, identity.userId, db);
        if (!result.ok) return { content: [{ type: "text" as const, text: result.message }] };
        const verb = result.alreadyAssigned ? "Already assigned" : "Added assignee";
        return {
          content: [{
            type: "text" as const,
            text: `${verb}: ${target.name ?? target.email} <${target.email}> on [${resolved.kind}] '${slug}'.`,
          }],
        };
      },
    );

    server.tool(
      "remove_assignee",
      "Remove an assignee from a doc or plan. Requires artifact edit permission.",
      assignmentToolInput,
      async ({ slug, kind, email }) => {
        const resolved = resolveDocOrPlan(slug, kind);
        if (!resolved.ok) return { content: [{ type: "text" as const, text: resolved.message }] };
        if (!(await canMutatePrompt(identityUser, resolved.artifact, db))) {
          return { content: [{ type: "text" as const, text: `Access denied: cannot manage assignment for '${slug}'.` }] };
        }
        const target = await resolveAssignmentTarget(email);
        if (!target) {
          return { content: [{ type: "text" as const, text: "Target user not found or cannot be assigned." }] };
        }
        const result = await removeAssignee(resolved.artifact, target.id, identity.userId, db);
        if (!result.ok) return { content: [{ type: "text" as const, text: result.message }] };
        const verb = result.removed ? "Removed assignee" : "Was not assigned";
        return {
          content: [{
            type: "text" as const,
            text: `${verb}: ${target.name ?? target.email} <${target.email}> on [${resolved.kind}] '${slug}'.`,
          }],
        };
      },
    );

    server.tool(
      "update_work_item",
      "Update status, priority, or due date for a Doc/Plan work item. Assignees may update status; priority and due date require artifact edit permission.",
      {
        slug: z.string().describe("Slug of the doc or plan"),
        kind: z.enum(["doc", "plan"]).optional().describe("Disambiguate when a doc and a plan share the same slug"),
        status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      },
      async ({ slug, kind, status, priority, dueDate }) => {
        if (status === undefined && priority === undefined && dueDate === undefined) {
          return { content: [{ type: "text" as const, text: "At least one of status, priority, or dueDate is required." }] };
        }
        const resolved = resolveDocOrPlan(slug, kind);
        if (!resolved.ok) return { content: [{ type: "text" as const, text: resolved.message }] };
        const result = await updateWorkItem(
          resolved.artifact,
          { status, priority, dueDate },
          identityUser,
          db,
        );
        if (!result.ok) return { content: [{ type: "text" as const, text: result.message }] };
        const changed = result.changedFields.length ? result.changedFields.join(", ") : "nothing (no-op)";
        return {
          content: [{
            type: "text" as const,
            text: `Updated [${resolved.kind}] '${slug}': ${changed}. Status=${result.after.status}, priority=${result.after.priority}, due=${result.after.dueDate ?? "none"}.`,
          }],
        };
      },
    );

    server.tool(
      "add_artifact_to_project",
      "Assign a doc or plan to a project. A doc/plan can belong to multiple projects (this is grouping, not ownership — it does not change the artifact's owner). Requires editor/admin on the project's owning group. Get the projectId from list_projects and the slug from create_plan/create_doc.",
      {
        projectId: z.string().uuid().describe("Project id (from list_projects output)"),
        slug: z.string().describe("Slug of the doc or plan to assign"),
        kind: z.enum(["doc", "plan"]).optional().describe("Disambiguate when a doc and a plan share the same slug"),
      },
      async ({ projectId, slug, kind }) => {
        const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
        if (!project) {
          return { content: [{ type: "text" as const, text: `Project '${projectId}' not found.` }] };
        }
        const manageable = await canManageProject(identityUser, project.ownerGroupType, project.ownerGroupId, db);
        if (!manageable) {
          return { content: [{ type: "text" as const, text: `Permission denied: you need editor or admin role in the project's owning group.` }] };
        }
        const resolved = resolveDocOrPlan(slug, kind);
        if (!resolved.ok) {
          return { content: [{ type: "text" as const, text: resolved.message }] };
        }
        const [row] = await db
          .insert(projectArtifacts)
          .values({ projectId, artifactId: resolved.id })
          .onConflictDoNothing()
          .returning();
        const verb = row ? "assigned to" : "already in";
        return { content: [{ type: "text" as const, text: `[${resolved.kind}] '${slug}' ${verb} project '${project.name}'.` }] };
      },
    );

    server.tool(
      "remove_artifact_from_project",
      "Remove a doc or plan from a project (does not delete the artifact). Requires editor/admin on the project's owning group.",
      {
        projectId: z.string().uuid().describe("Project id (from list_projects output)"),
        slug: z.string().describe("Slug of the doc or plan to remove"),
        kind: z.enum(["doc", "plan"]).optional().describe("Disambiguate when a doc and a plan share the same slug"),
      },
      async ({ projectId, slug, kind }) => {
        const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
        if (!project) {
          return { content: [{ type: "text" as const, text: `Project '${projectId}' not found.` }] };
        }
        const manageable = await canManageProject(identityUser, project.ownerGroupType, project.ownerGroupId, db);
        if (!manageable) {
          return { content: [{ type: "text" as const, text: `Permission denied: you need editor or admin role in the project's owning group.` }] };
        }
        const resolved = resolveDocOrPlan(slug, kind);
        if (!resolved.ok) {
          return { content: [{ type: "text" as const, text: resolved.message }] };
        }
        const deleted = await db
          .delete(projectArtifacts)
          .where(and(eq(projectArtifacts.projectId, projectId), eq(projectArtifacts.artifactId, resolved.id)))
          .returning();
        const msg = deleted.length
          ? `[${resolved.kind}] '${slug}' removed from project '${project.name}'.`
          : `[${resolved.kind}] '${slug}' was not assigned to project '${project.name}' (no-op).`;
        return { content: [{ type: "text" as const, text: msg }] };
      },
    );
  }

  return server;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Path-safety for agent-supplied skill files (Phase 50 M2) — mirrors the Go
 * CLI's AssertSafeRelativePath (src/cli/internal/fsio/fsio.go): reject
 * absolute paths and any path that escapes its directory via "..". Unlike
 * the tRPC skill router (trusted, UI-authenticated input only), this reaches
 * an MCP tool call, so it must be validated here before it ever lands in
 * artifactFiles — the same content a human later `pull`s onto a real
 * filesystem via the CLI.
 */
function assertSafeFilePaths(files: { path: string }[]): string | undefined {
  for (const f of files) {
    if (f.path.startsWith("/") || f.path.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(f.path)) {
      return `Refusing to write absolute path: '${f.path}'.`;
    }
    const normalized = posix.normalize(f.path.replace(/\\/g, "/"));
    if (normalized === ".." || normalized.startsWith("../")) {
      return `Refusing to write path that escapes its directory: '${f.path}'.`;
    }
  }
  return undefined;
}

/**
 * True if `newSlug` is already used by a *different* artifact in the same
 * owner space (the artifacts_owner_slug_uniq partial index). Checked in the
 * update_* tools before renaming so a collision returns a friendly message
 * instead of the DB throwing a raw unique-violation (23505). Slugs are stored
 * as the local segment (no space-path prefix), same as what these tools accept.
 */
async function isSlugTaken(
  newSlug: string,
  artifact: { id: string; ownerType: string; ownerId: string },
): Promise<boolean> {
  const existing = await db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.ownerType, artifact.ownerType as "user" | "org" | "department" | "team"),
      eq(artifacts.ownerId, artifact.ownerId),
      eq(artifacts.slug, newSlug),
    ),
    columns: { id: true },
  });
  return !!existing && existing.id !== artifact.id;
}

/**
 * Usage analytics (Phase 41) — fire-and-forget, deliberately not awaited on
 * the tool-response path (Phase 39 cut this exact request down to 8 queries;
 * blocking every content read on a write would give half of that back).
 * Called only where an agent actually retrieves content (prompt invoked,
 * get_skill/get_plan/get_doc) — not on list/search, which only
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
    columns: {
      id: true,
      kind: true,
      title: true,
      description: true,
      slug: true,
      ownerType: true,
      ownerId: true,
      visibility: true,
      createdBy: true,
      tags: true,
      fetchCount: true,
    },
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
