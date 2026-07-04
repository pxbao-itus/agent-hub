import { z } from "zod";
import { eq, desc, asc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { artifacts, artifactVersions, artifactMembers, artifactTasks } from "@/server/db/schema";
import { canAccessArtifact, canMutatePrompt, effectiveGroupRole } from "@/server/auth/access";
import { createArtifact } from "@/server/services/artifact";

const BULK_MAX = 100;

const artifactKindEnum = z.enum(["prompt", "skill", "kit", "plan", "doc"]);

/**
 * Bundle format for export/import — v1. Member refs carry the real artifact
 * id (not slug): most artifacts have no stored slug at all (it's optional),
 * and resolving by title+kind would be ambiguous across titles. Importing
 * with a member id that exists and is accessible re-links to that *same*
 * artifact (by-reference, same semantics as duplicate's kit-member copying)
 * rather than creating a new copy of it — kind/title are carried alongside
 * only for display and as the label shown when a member has to be skipped.
 */
export const artifactBundleSchema = z.object({
  schemaVersion: z.literal(1),
  kind: artifactKindEnum,
  title: z.string().min(1).max(200),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  body: z.string(),
  files: z
    .array(z.object({ path: z.string().min(1).max(500), content: z.string(), mimeType: z.string().nullable().optional() }))
    .default([]),
  members: z.array(z.object({ id: z.string().uuid(), kind: artifactKindEnum, title: z.string() })).default([]),
  tasks: z
    .array(
      z.object({
        content: z.string().min(1),
        status: z.enum(["todo", "doing", "done"]).default("todo"),
        position: z.number().int().min(0).optional(),
      }),
    )
    .default([]),
});
export type ArtifactBundle = z.infer<typeof artifactBundleSchema>;

/**
 * Generic operations across all artifact kinds — as opposed to prompt.ts/
 * skill.ts/kit.ts/plan.ts/doc.ts, which each own their kind-specific create/
 * update/delete. Duplicate only needs read access to the source and doesn't
 * care what kind it is, so one mutation here covers all five instead of
 * five near-identical copies.
 */
export const artifactRouter = router({
  duplicate: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        ownerType: z.enum(["user", "org", "department", "team"]).default("user"),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const source = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.sourceId),
        with: { versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 } },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, source, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

      const version = source.versions[0];
      if (!version) throw new TRPCError({ code: "BAD_REQUEST", message: "Source has no version to copy" });

      const targetOwnerType = input.ownerType;
      const targetOwnerId = targetOwnerType === "user" ? userId : (input.ownerId ?? userId);

      if (targetOwnerType !== "user" && systemRole !== "superadmin") {
        const role = await effectiveGroupRole(userId, targetOwnerType, targetOwnerId, ctx.db);
        if (role !== "editor" && role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "You need editor or admin role in that group space" });
        }
      }

      let files: { path: string; content: string; mimeType?: string | null }[] | undefined;
      let members: { memberArtifactId: string; position: number }[] | undefined;
      let tasks: { content: string; status?: "todo" | "doing" | "done"; position?: number }[] | undefined;
      let skippedMembers = 0;

      if (source.kind === "skill") {
        const versionWithFiles = await ctx.db.query.artifactVersions.findFirst({
          where: eq(artifactVersions.id, version.id),
          with: { files: true },
        });
        files = versionWithFiles?.files.map((f) => ({ path: f.path, content: f.content, mimeType: f.mimeType }));
      }

      if (source.kind === "kit") {
        const memberRows = await ctx.db.query.artifactMembers.findMany({
          where: eq(artifactMembers.kitArtifactId, source.id),
          orderBy: asc(artifactMembers.position),
        });
        const kept: { memberArtifactId: string; position: number }[] = [];
        for (const m of memberRows) {
          const memberArtifact = await ctx.db.query.artifacts.findFirst({
            where: eq(artifacts.id, m.memberArtifactId),
          });
          const memberAccessible =
            memberArtifact && (await canAccessArtifact({ userId, systemRole }, memberArtifact, ctx.db));
          if (memberAccessible) {
            kept.push({ memberArtifactId: m.memberArtifactId, position: kept.length });
          } else {
            skippedMembers++;
          }
        }
        members = kept;
      }

      if (source.kind === "plan") {
        const taskRows = await ctx.db.query.artifactTasks.findMany({
          where: eq(artifactTasks.artifactId, source.id),
          orderBy: asc(artifactTasks.position),
        });
        tasks = taskRows.map((t) => ({ content: t.content, status: t.status, position: t.position }));
      }

      // Group artifacts can't be private (same rule prompt/skill/kit/plan/doc
      // create mutations already enforce) — only "user" ownership gets to be
      // private by default.
      const copy = await createArtifact(
        {
          kind: source.kind,
          ownerType: targetOwnerType,
          ownerId: targetOwnerId,
          title: `${source.title} (copy)`,
          slug: null,
          description: source.description ?? undefined,
          tags: source.tags,
          visibility: targetOwnerType === "user" ? "private" : "group",
          body: version.body,
          changelog: `Duplicated from "${source.title}"`,
          createdBy: userId,
          files,
          members,
          tasks,
        },
        ctx.db,
      );

      return { ...copy, skippedMembers };
    }),

  export: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<ArtifactBundle> => {
      const { userId, systemRole } = ctx.session;

      const source = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.id),
        with: { versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 } },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, source, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

      const version = source.versions[0];
      if (!version) throw new TRPCError({ code: "BAD_REQUEST", message: "Source has no version to export" });

      let files: ArtifactBundle["files"] = [];
      let members: ArtifactBundle["members"] = [];
      let tasks: ArtifactBundle["tasks"] = [];

      if (source.kind === "skill") {
        const versionWithFiles = await ctx.db.query.artifactVersions.findFirst({
          where: eq(artifactVersions.id, version.id),
          with: { files: true },
        });
        files = versionWithFiles?.files.map((f) => ({ path: f.path, content: f.content, mimeType: f.mimeType })) ?? [];
      }

      if (source.kind === "kit") {
        const memberRows = await ctx.db.query.artifactMembers.findMany({
          where: eq(artifactMembers.kitArtifactId, source.id),
          orderBy: asc(artifactMembers.position),
        });
        const memberIds = memberRows.map((m) => m.memberArtifactId);
        const memberArtifacts = memberIds.length
          ? await ctx.db.query.artifacts.findMany({
              where: inArray(artifacts.id, memberIds),
              columns: { id: true, kind: true, title: true },
            })
          : [];
        const memberMap = new Map(memberArtifacts.map((a) => [a.id, a]));
        members = memberRows
          .map((m) => memberMap.get(m.memberArtifactId))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map((a) => ({ id: a.id, kind: a.kind, title: a.title }));
      }

      if (source.kind === "plan") {
        const taskRows = await ctx.db.query.artifactTasks.findMany({
          where: eq(artifactTasks.artifactId, source.id),
          orderBy: asc(artifactTasks.position),
        });
        tasks = taskRows.map((t) => ({ content: t.content, status: t.status, position: t.position }));
      }

      return {
        schemaVersion: 1,
        kind: source.kind,
        title: source.title,
        slug: source.slug,
        description: source.description,
        tags: source.tags,
        body: version.body,
        files,
        members,
        tasks,
      };
    }),

  import: protectedProcedure
    .input(
      z.object({
        bundle: artifactBundleSchema,
        ownerType: z.enum(["user", "org", "department", "team"]).default("user"),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { bundle } = input;

      const targetOwnerType = input.ownerType;
      const targetOwnerId = targetOwnerType === "user" ? userId : (input.ownerId ?? userId);

      if (targetOwnerType !== "user" && systemRole !== "superadmin") {
        const role = await effectiveGroupRole(userId, targetOwnerType, targetOwnerId, ctx.db);
        if (role !== "editor" && role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "You need editor or admin role in that group space" });
        }
      }

      let resolvedMembers: { memberArtifactId: string; position: number }[] | undefined;
      const skippedMembers: string[] = [];

      if (bundle.kind === "kit" && bundle.members.length > 0) {
        const memberIds = bundle.members.map((m) => m.id);
        const found = await ctx.db.query.artifacts.findMany({ where: inArray(artifacts.id, memberIds) });
        const foundMap = new Map(found.map((a) => [a.id, a]));
        const kept: { memberArtifactId: string; position: number }[] = [];
        for (const ref of bundle.members) {
          const artifact = foundMap.get(ref.id);
          const memberAccessible = artifact && (await canAccessArtifact({ userId, systemRole }, artifact, ctx.db));
          if (memberAccessible) {
            kept.push({ memberArtifactId: ref.id, position: kept.length });
          } else {
            skippedMembers.push(ref.title);
          }
        }
        resolvedMembers = kept;
      }

      const created = await createArtifact(
        {
          kind: bundle.kind,
          ownerType: targetOwnerType,
          ownerId: targetOwnerId,
          title: bundle.title,
          // Reset, same reasoning as duplicate: avoid colliding with the
          // owner-scoped unique slug index (D-019/P38) on re-import.
          slug: null,
          description: bundle.description ?? undefined,
          tags: bundle.tags,
          visibility: targetOwnerType === "user" ? "private" : "group",
          body: bundle.body,
          changelog: `Imported: "${bundle.title}"`,
          createdBy: userId,
          files: bundle.kind === "skill" ? bundle.files : undefined,
          members: resolvedMembers,
          tasks: bundle.kind === "plan" ? bundle.tasks : undefined,
        },
        ctx.db,
      );

      return { ...created, skippedMembers };
    }),

  /**
   * Bulk delete (Phase 45 B2). The client is expected to call this only
   * after its own delayed-execute/Undo grace window elapses (B1) — this
   * mutation itself deletes immediately, same as the single-kind `delete`
   * mutations. Skips (and reports) ids the caller can't mutate rather than
   * failing the whole batch.
   */
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(BULK_MAX) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const rows = await ctx.db.query.artifacts.findMany({
        where: inArray(artifacts.id, input.ids),
        columns: { id: true, ownerType: true, ownerId: true },
      });
      const rowById = new Map(rows.map((r) => [r.id, r]));

      const deletableIds: string[] = [];
      const skippedIds: string[] = [];
      for (const id of input.ids) {
        const row = rowById.get(id);
        const allowed = row && (await canMutatePrompt({ userId, systemRole }, row, ctx.db));
        if (allowed) deletableIds.push(id);
        else skippedIds.push(id);
      }

      if (deletableIds.length > 0) {
        await ctx.db.delete(artifacts).where(inArray(artifacts.id, deletableIds));
      }

      return { deletedIds: deletableIds, skippedIds };
    }),

  /** Bulk-add a tag (Phase 45 B2). Skips ids the caller can't mutate; a no-op (still counted as success) if the tag is already present. */
  bulkAddTag: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(BULK_MAX), tag: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const rows = await ctx.db.query.artifacts.findMany({
        where: inArray(artifacts.id, input.ids),
        columns: { id: true, ownerType: true, ownerId: true, tags: true },
      });
      const rowById = new Map(rows.map((r) => [r.id, r]));

      const updatedIds: string[] = [];
      const skippedIds: string[] = [];
      for (const id of input.ids) {
        const row = rowById.get(id);
        if (!row) {
          skippedIds.push(id);
          continue;
        }
        const allowed = await canMutatePrompt({ userId, systemRole }, row, ctx.db);
        if (!allowed) {
          skippedIds.push(id);
          continue;
        }
        if (!row.tags.includes(input.tag)) {
          await ctx.db
            .update(artifacts)
            .set({ tags: [...row.tags, input.tag], updatedAt: new Date() })
            .where(eq(artifacts.id, id));
        }
        updatedIds.push(id);
      }

      return { updatedIds, skippedIds };
    }),
});
