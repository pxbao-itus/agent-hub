import { sql } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";

export const appRouter = router({
  /** Kiểm tra app sống + kết nối DB. */
  health: publicProcedure.query(async ({ ctx }) => {
    let dbOk = false;
    try {
      await ctx.db.execute(sql`select 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return { ok: true, db: dbOk };
  }),
});

export type AppRouter = typeof appRouter;
