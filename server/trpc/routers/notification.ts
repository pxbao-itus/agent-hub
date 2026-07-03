import { z } from "zod";
import { eq, and, desc, count } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { notifications } from "@/server/db/schema";

export const notificationRouter = router({
  /** Most recent notifications for the caller, newest first. */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.notifications.findMany({
        where: eq(notifications.userId, ctx.session.userId),
        orderBy: desc(notifications.createdAt),
        limit: input.limit,
        with: {
          actor: { columns: { id: true, name: true, email: true } },
          artifact: { columns: { id: true, kind: true, title: true } },
        },
      });
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ cnt: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.session.userId), eq(notifications.isRead, false)));
    return { count: row?.cnt ?? 0 };
  }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.session.userId)))
        .returning();
      return row ?? null;
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, ctx.session.userId), eq(notifications.isRead, false)));
    return { ok: true };
  }),
});
