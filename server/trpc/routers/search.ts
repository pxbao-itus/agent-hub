import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { artifactAccessCondition } from "@/server/auth/access";
import { hybridSearch, fetchArtifactsByIds } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";

export const searchRouter = router({
  /** Cross-kind quick search for the Cmd/Ctrl-K command palette. Top 8, any kind. */
  quick: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      if (!q) return [];

      const { userId, systemRole } = ctx.session;
      const accessCondition = await artifactAccessCondition(userId, systemRole, ctx.db);

      const { ids } = await hybridSearch({
        query: q,
        accessCondition,
        embedder: getEmbedder(),
        db: ctx.db,
        limit: 8,
        offset: 0,
      });
      const rows = await fetchArtifactsByIds(ids, ctx.db);

      return rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind }));
    }),
});
