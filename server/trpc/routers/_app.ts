import { sql } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { artifactRouter } from "./artifact";
import { orgRouter } from "./org";
import { promptRouter } from "./prompt";
import { skillRouter } from "./skill";
import { planRouter } from "./plan";
import { docRouter } from "./doc";
import { linkRouter } from "./link";
import { shareRouter } from "./share";
import { assignmentRouter } from "./assignment";
import { notificationRouter } from "./notification";
import { favoriteRouter } from "./favorite";
import { projectRouter } from "./project";
import { workflowRouter } from "./workflow";
import { auditRouter } from "./audit";
import { tokenRouter } from "./token";
import { userRouter } from "./user";
import { searchRouter } from "./search";
import { commentRouter } from "./comment";

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
  plan: planRouter,
  doc: docRouter,
  link: linkRouter,
  share: shareRouter,
  assignment: assignmentRouter,
  notification: notificationRouter,
  favorite: favoriteRouter,
  project: projectRouter,
  workflow: workflowRouter,
  audit: auditRouter,
  token: tokenRouter,
  user: userRouter,
  search: searchRouter,
  comment: commentRouter,
});

export type AppRouter = typeof appRouter;
