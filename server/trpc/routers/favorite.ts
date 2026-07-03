import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { artifacts, artifactFavorites } from "@/server/db/schema";
import { artifactAccessCondition } from "@/server/auth/access";

export const favoriteRouter = router({
  toggle: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session;

      const existing = await ctx.db.query.artifactFavorites.findFirst({
        where: and(eq(artifactFavorites.userId, userId), eq(artifactFavorites.artifactId, input.artifactId)),
        columns: { id: true },
      });

      if (existing) {
        await ctx.db.delete(artifactFavorites).where(eq(artifactFavorites.id, existing.id));
        return { favorited: false };
      }

      await ctx.db.insert(artifactFavorites).values({ userId, artifactId: input.artifactId });
      return { favorited: true };
    }),

  /** Most-recently-starred artifacts still accessible to the caller, for the dashboard's Favorites section. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { userId, systemRole } = ctx.session;
    const accessWhere = await artifactAccessCondition(userId, systemRole, ctx.db);

    return ctx.db
      .select({
        id: artifacts.id,
        kind: artifacts.kind,
        title: artifacts.title,
        description: artifacts.description,
      })
      .from(artifactFavorites)
      .innerJoin(artifacts, eq(artifacts.id, artifactFavorites.artifactId))
      .where(and(eq(artifactFavorites.userId, userId), accessWhere))
      .orderBy(desc(artifactFavorites.createdAt))
      .limit(10);
  }),
});
