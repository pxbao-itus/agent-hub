import { sql } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { artifactRouter } from "./artifact";
import { orgRouter } from "./org";
import { promptRouter } from "./prompt";
import { skillRouter } from "./skill";
import { kitRouter } from "./kit";
import { planRouter } from "./plan";
import { docRouter } from "./doc";
import { linkRouter } from "./link";
import { shareRouter } from "./share";
import { notificationRouter } from "./notification";
import { favoriteRouter } from "./favorite";
import { tokenRouter } from "./token";
import { userRouter } from "./user";
import { searchRouter } from "./search";

export const appRouter = router({
  /** Health check: confirms the app is up and the DB is reachable. */
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

  artifact: artifactRouter,
  org: orgRouter,
  prompt: promptRouter,
  skill: skillRouter,
  kit: kitRouter,
  plan: planRouter,
  doc: docRouter,
  link: linkRouter,
  share: shareRouter,
  notification: notificationRouter,
  favorite: favoriteRouter,
  token: tokenRouter,
  user: userRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
