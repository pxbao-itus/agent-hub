import { z } from "zod";
import { eq, and, asc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { artifacts, artifactLinks } from "@/server/db/schema";
import { canAccessArtifact, canMutatePrompt } from "@/server/auth/access";

export const linkRouter = router({
  /** List docs linked FROM a source artifact (e.g. plan). Filtered to what viewer can access. */
  listForSource: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid(), relation: z.string().default("doc") }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const source = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.sourceId),
        columns: { id: true, ownerType: true, ownerId: true, visibility: true, kind: true },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, source, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

      const links = await ctx.db.query.artifactLinks.findMany({
        where: and(
          eq(artifactLinks.sourceArtifactId, input.sourceId),
          eq(artifactLinks.relation, input.relation),
        ),
        orderBy: asc(artifactLinks.position),
        with: {
          target: {
            with: { versions: { limit: 1, orderBy: sql`version_no DESC` } },
          },
        },
      });

      // Flatten target to a stable shape (incl. body) so the live query matches
      // what the server-rendered initialData provides.
      const accessible_links = [];
      for (const link of links) {
        if (!link.target) continue;
        const ok = await canAccessArtifact({ userId, systemRole }, link.target, ctx.db);
        if (!ok) continue;
        accessible_links.push({
          id: link.id,
          position: link.position,
          target: {
            id: link.target.id,
            title: link.target.title,
            description: link.target.description,
            slug: link.target.slug,
            body: link.target.versions[0]?.body ?? null,
          },
        });
      }

      return accessible_links;
    }),

  /** List artifacts that link TO a target doc (reverse trace). Filtered to what viewer can access. */
  listForTarget: protectedProcedure
    .input(z.object({ targetId: z.string().uuid(), relation: z.string().default("doc") }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const target = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.targetId),
        columns: { id: true, ownerType: true, ownerId: true, visibility: true, kind: true },
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, target, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

      const links = await ctx.db.query.artifactLinks.findMany({
        where: and(
          eq(artifactLinks.targetArtifactId, input.targetId),
          eq(artifactLinks.relation, input.relation),
        ),
        orderBy: asc(artifactLinks.createdAt),
        with: { source: true },
      });

      const accessible_links = [];
      for (const link of links) {
        if (!link.source) continue;
        const ok = await canAccessArtifact({ userId, systemRole }, link.source, ctx.db);
        if (ok) accessible_links.push(link);
      }

      return accessible_links;
    }),

  add: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        targetId: z.string().uuid(),
        relation: z.string().default("doc"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      if (input.sourceId === input.targetId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot link an artifact to itself" });
      }

      const [source, target] = await Promise.all([
        ctx.db.query.artifacts.findFirst({ where: eq(artifacts.id, input.sourceId) }),
        ctx.db.query.artifacts.findFirst({ where: eq(artifacts.id, input.targetId) }),
      ]);
      if (!source || !target) throw new TRPCError({ code: "NOT_FOUND" });

      const [canEdit, canRead] = await Promise.all([
        canMutatePrompt({ userId, systemRole }, source, ctx.db),
        canAccessArtifact({ userId, systemRole }, target, ctx.db),
      ]);
      if (!canEdit) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit source artifact" });
      if (!canRead) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot access target artifact" });

      // position = current max + 1
      const [{ maxPos }] = await ctx.db
        .select({ maxPos: sql<number>`coalesce(max(position), -1)` })
        .from(artifactLinks)
        .where(and(
          eq(artifactLinks.sourceArtifactId, input.sourceId),
          eq(artifactLinks.relation, input.relation),
        ));

      const [link] = await ctx.db
        .insert(artifactLinks)
        .values({
          sourceArtifactId: input.sourceId,
          targetArtifactId: input.targetId,
          relation: input.relation,
          position: maxPos + 1,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();

      return link ?? null;
    }),

  remove: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        targetId: z.string().uuid(),
        relation: z.string().default("doc"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const source = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.sourceId),
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const canEdit = await canMutatePrompt({ userId, systemRole }, source, ctx.db);
      if (!canEdit) throw new TRPCError({ code: "FORBIDDEN" });

      await ctx.db
        .delete(artifactLinks)
        .where(
          and(
            eq(artifactLinks.sourceArtifactId, input.sourceId),
            eq(artifactLinks.targetArtifactId, input.targetId),
            eq(artifactLinks.relation, input.relation),
          ),
        );
    }),

  /** Reorder docs linked to a source: supply new ordered array of targetIds. */
  reorder: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        relation: z.string().default("doc"),
        orderedTargetIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const source = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.sourceId),
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const canEdit = await canMutatePrompt({ userId, systemRole }, source, ctx.db);
      if (!canEdit) throw new TRPCError({ code: "FORBIDDEN" });

      for (const [i, targetId] of input.orderedTargetIds.entries()) {
        await ctx.db
          .update(artifactLinks)
          .set({ position: i })
          .where(
            and(
              eq(artifactLinks.sourceArtifactId, input.sourceId),
              eq(artifactLinks.targetArtifactId, targetId),
              eq(artifactLinks.relation, input.relation),
            ),
          );
      }
    }),
});
